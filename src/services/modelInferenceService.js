import * as tf from '@tensorflow/tfjs';
import { readFile } from 'fs/promises';

const TRAINING_WEIGHTS = {
  popularity: 0.2,
  genre: 0.7,
  age: 0.1
};

const artifactCache = new Map();

const normalize = (value, min, max) => {
  const safeValue = Number.isFinite(value) ? value : min;
  const denom = (max - min) || 1;
  return (safeValue - min) / denom;
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const calculateAge = (birthDate) => {
  if (!birthDate) return 30;
  const now = new Date();
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return 30;

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  const dayDiff = now.getUTCDate() - birth.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;

  return clamp(age, 13, 90);
};

const averageVectors = (vectors) => {
  if (!vectors.length) return [];
  const size = vectors[0].length;
  const out = new Array(size).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < size; i += 1) out[i] += vec[i];
  }

  for (let i = 0; i < size; i += 1) out[i] /= vectors.length;
  return out;
};

const encodeMovieVector = (movie, featureMetadata) => {
  const schema = featureMetadata.vectorSchema || 'v1_legacy';
  const norm = featureMetadata.normalization || {};
  const genreIndex = featureMetadata.genreIndex || {};

  const popularityFeature = normalize(Number(movie.popularity_score || 0), norm.minPopularity, norm.maxPopularity) * TRAINING_WEIGHTS.popularity;
  // Backward compatibility with artifacts where avg age per movie was not persisted.
  const movieAvgAgeNorm = featureMetadata.movieAvgAgeNorm?.[movie.id] ?? 0.5;
  const audienceAgeFeature = movieAvgAgeNorm * TRAINING_WEIGHTS.age;

  const genres = Array.isArray(movie.genres) ? movie.genres : [];
  const primaryGenre = genres.length ? genres[0] : 'Unknown';
  const genreVector = new Array(featureMetadata.numGenres || 0).fill(0);
  const genreIdx = genreIndex[primaryGenre];
  if (Number.isInteger(genreIdx)) genreVector[genreIdx] = TRAINING_WEIGHTS.genre;

  if (schema === 'v2_age_genre_popularity') {
    return [popularityFeature, ...genreVector];
  }

  return [popularityFeature, audienceAgeFeature, ...genreVector];
};

const createModelFromArtifact = (artifact) => {
  const inputDimension = artifact.architecture?.inputDimension;
  const hiddenLayers = artifact.architecture?.hiddenLayers || [128, 64, 32];

  if (!Number.isInteger(inputDimension) || inputDimension <= 0) {
    throw new Error('Invalid model artifact: missing inputDimension.');
  }

  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [inputDimension], units: hiddenLayers[0], activation: 'relu' }));
  for (let i = 1; i < hiddenLayers.length; i += 1) {
    model.add(tf.layers.dense({ units: hiddenLayers[i], activation: 'relu' }));
  }
  model.add(tf.layers.dense({ units: 1, activation: artifact.architecture?.activation || 'sigmoid' }));

  const tensors = (artifact.weights || []).map((weight) => tf.tensor(weight.values, weight.shape, weight.dtype));
  model.setWeights(tensors);

  tensors.forEach((t) => t.dispose());
  return model;
};

const getArtifact = async (storageUri) => {
  if (artifactCache.has(storageUri)) return artifactCache.get(storageUri);
  const raw = await readFile(storageUri, 'utf-8');
  const artifact = JSON.parse(raw);
  artifactCache.set(storageUri, artifact);
  return artifact;
};

const loadCandidateMovies = async (client, userId) => {
  const result = await client.query(
    `
      WITH watched_movies AS (
        SELECT DISTINCT ie.movie_id
        FROM interaction_events ie
        WHERE ie.user_id = $1
      ),
      movie_audience_age AS (
        SELECT
          ie.movie_id,
          AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, u.birth_date))) AS audience_avg_age
        FROM interaction_events ie
        JOIN users u ON u.id = ie.user_id
        WHERE ie.event_type IN ('watch_start', 'watch_complete')
          AND u.birth_date IS NOT NULL
        GROUP BY ie.movie_id
      )
      SELECT
        m.id,
        m.external_id,
        m.title,
        m.release_date,
        m.popularity_score,
        ROUND(maa.audience_avg_age::numeric, 1) AS audience_avg_age,
        COALESCE(ARRAY_AGG(g.name ORDER BY g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres
      FROM movies m
      LEFT JOIN movie_genres mg ON mg.movie_id = m.id
      LEFT JOIN genres g ON g.id = mg.genre_id
      LEFT JOIN movie_audience_age maa ON maa.movie_id = m.id
      WHERE m.id NOT IN (SELECT movie_id FROM watched_movies)
      GROUP BY m.id, maa.audience_avg_age
      ORDER BY m.popularity_score DESC, m.title
    `,
    [userId]
  );

  return result.rows;
};

const loadAllMoviesForUserProfile = async (client) => {
  const result = await client.query(
    `
      SELECT
        m.id,
        m.popularity_score,
        COALESCE(ARRAY_AGG(g.name ORDER BY g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres
      FROM movies m
      LEFT JOIN movie_genres mg ON mg.movie_id = m.id
      LEFT JOIN genres g ON g.id = mg.genre_id
      GROUP BY m.id
    `
  );

  return result.rows;
};

const loadUserPositiveMovieIds = async (client, userId) => {
  const result = await client.query(
    `
      SELECT DISTINCT ie.movie_id
      FROM interaction_events ie
      WHERE ie.user_id = $1
        AND (
          ie.event_type = 'like'
          OR ie.event_type = 'watch_complete'
          OR (ie.event_type = 'rating' AND ie.event_value >= 4)
        )
    `,
    [userId]
  );

  return new Set(result.rows.map((row) => row.movie_id));
};

const loadUserGenreSignals = async (client, userId) => {
  const result = await client.query(
    `
      SELECT
        g.name AS genre,
        SUM(
          CASE
            WHEN ie.event_type = 'like' THEN 2.0
            WHEN ie.event_type = 'watch_complete' THEN 1.5
            WHEN ie.event_type = 'watch_start' THEN 1.0
            WHEN ie.event_type = 'rating' AND ie.event_value >= 4 THEN 1.5
            WHEN ie.event_type = 'rating' AND ie.event_value <= 2 THEN -1.0
            WHEN ie.event_type = 'skip' THEN -0.8
            ELSE 0.0
          END
        ) AS signal
      FROM interaction_events ie
      JOIN movie_genres mg ON mg.movie_id = ie.movie_id
      JOIN genres g ON g.id = mg.genre_id
      WHERE ie.user_id = $1
      GROUP BY g.name
      ORDER BY signal DESC, g.name
    `,
    [userId]
  );

  return result.rows
    .map((row) => ({ genre: row.genre, signal: Number(row.signal || 0) }))
    .filter((row) => row.signal > 0);
};

const getPrimaryGenre = (movie) => {
  if (Array.isArray(movie.genresArray) && movie.genresArray.length) {
    return String(movie.genresArray[0]);
  }

  if (Array.isArray(movie.genres) && movie.genres.length) {
    return String(movie.genres[0]);
  }

  if (typeof movie.genres === 'string' && movie.genres.trim()) {
    return movie.genres.split(',')[0].trim() || 'Unknown';
  }

  return 'Unknown';
};

const applyGenreAwareRerank = ({ recommendations, userGenreSignals, limit }) => {
  if (!recommendations.length) return recommendations;

  const topGenres = userGenreSignals.slice(0, 2).map((g) => g.genre);
  const topGenre = topGenres[0] || null;
  const topTwo = new Set(topGenres);

  const rescored = recommendations
    .map((item) => {
      const primaryGenre = getPrimaryGenre(item);
      let multiplier = 1;

      if (topGenre && primaryGenre === topGenre) {
        multiplier = 1.22;
      } else if (topTwo.has(primaryGenre)) {
        multiplier = 1.10;
      } else if (topTwo.size > 0) {
        multiplier = 0.78;
      }

      return {
        ...item,
        primaryGenre,
        score: Number((item.score * multiplier).toFixed(6))
      };
    })
    .sort((a, b) => b.score - a.score);

  // Cap repeated genres in the first five positions to improve top-list diversity.
  const topWindow = Math.min(5, limit);
  const selected = [];
  const deferred = [];
  const topGenreCounts = new Map();

  for (const item of rescored) {
    if (selected.length < topWindow) {
      const count = topGenreCounts.get(item.primaryGenre) || 0;
      if (count >= 2) {
        deferred.push(item);
        continue;
      }
      selected.push(item);
      topGenreCounts.set(item.primaryGenre, count + 1);
      continue;
    }

    deferred.push(item);
  }

  for (const item of deferred) {
    if (selected.length >= limit) break;
    selected.push(item);
  }

  return selected.slice(0, limit).map(({ primaryGenre, ...rest }) => rest);
};

const buildUserVector = ({ userAge, featureMetadata, movieVectorById, positiveMovieIds }) => {
  const schema = featureMetadata.vectorSchema || 'v1_legacy';
  const norm = featureMetadata.normalization || {};
  const numGenres = featureMetadata.numGenres || 0;

  const positiveVectors = Array.from(positiveMovieIds)
    .map((id) => movieVectorById.get(id))
    .filter(Boolean);

  if (schema === 'v2_age_genre_popularity') {
    const ageFeature = normalize(userAge, norm.minAge, norm.maxAge) * TRAINING_WEIGHTS.age;
    let userGenreVector;
    if (positiveVectors.length) {
      userGenreVector = averageVectors(positiveVectors).slice(1);
    } else {
      userGenreVector = new Array(numGenres).fill(0);
    }

    return [ageFeature, ...userGenreVector];
  }

  let userVector;
  if (positiveVectors.length) {
    userVector = averageVectors(positiveVectors);
  } else {
    userVector = [
      0,
      normalize(userAge, norm.minAge, norm.maxAge) * TRAINING_WEIGHTS.age,
      ...new Array(numGenres).fill(0)
    ];
  }

  const ageFeature = normalize(userAge, norm.minAge, norm.maxAge) * TRAINING_WEIGHTS.age;
  userVector[1] = clamp((userVector[1] + ageFeature) / 2);

  return userVector;
};

export const getActiveModelRecord = async (client) => {
  const result = await client.query(
    `
      SELECT id, model_name, model_version, storage_uri, created_at
      FROM model_registry
      WHERE is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `
  );

  return result.rows[0] || null;
};

export const generateModelRecommendations = async ({ client, user, limit }) => {
  const activeModel = await getActiveModelRecord(client);
  if (!activeModel) {
    return null;
  }

  const artifact = await getArtifact(activeModel.storage_uri);
  const featureMetadata = artifact.featureMetadata || {};

  const candidateMovies = await loadCandidateMovies(client, user.id);
  const allMovies = await loadAllMoviesForUserProfile(client);
  const positiveMovieIds = await loadUserPositiveMovieIds(client, user.id);
  const userGenreSignals = await loadUserGenreSignals(client, user.id);

  if (!candidateMovies.length) {
    return { recommendations: [], model: activeModel, strategy: 'active_model_inference_v1' };
  }

  const movieVectorById = new Map();
  for (const movie of allMovies) {
    movieVectorById.set(movie.id, encodeMovieVector(movie, featureMetadata));
  }

  const userAge = calculateAge(user.birth_date);
  const userVector = buildUserVector({ userAge, featureMetadata, movieVectorById, positiveMovieIds });

  const model = createModelFromArtifact(artifact);
  const inputs = candidateMovies.map((movie) => {
    const movieVector = movieVectorById.get(movie.id) || encodeMovieVector(movie, featureMetadata);
    return [...userVector, ...movieVector];
  });

  const inputTensor = tf.tensor2d(inputs);
  const predictionTensor = model.predict(inputTensor);
  const scores = Array.from(await predictionTensor.data());

  inputTensor.dispose();
  predictionTensor.dispose();
  model.dispose();

  const modelRecommendations = candidateMovies
    .map((movie, index) => ({
      id: movie.id,
      external_id: movie.external_id,
      title: movie.title,
      release_date: movie.release_date,
      popularity_score: movie.popularity_score,
      audience_avg_age: movie.audience_avg_age !== null && movie.audience_avg_age !== undefined
        ? Number(movie.audience_avg_age)
        : null,
      genres: (movie.genres || []).join(', '),
      genresArray: movie.genres || [],
      score: Number(scores[index] || 0)
    }))
    .sort((a, b) => b.score - a.score);

  const recommendations = applyGenreAwareRerank({
    recommendations: modelRecommendations,
    userGenreSignals,
    limit
  }).map(({ genresArray, ...item }) => item);

  return {
    recommendations,
    model: activeModel,
    strategy: 'active_model_inference_v2_genre_rerank'
  };
};
