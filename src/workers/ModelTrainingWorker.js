import * as tf from '@tensorflow/tfjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models');

const TRAINING_WEIGHTS = {
  popularity: 0.2,
  genre: 0.7,
  age: 0.1
};

const DEFAULT_MAX_USERS = 7;
const DEFAULT_MAX_MOVIES = 30;
const DEFAULT_MAX_GENRES = 6;

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

const encodeMovieVector = (movie, ctx) => {
  const popularityFeature = normalize(movie.popularityScore, ctx.minPopularity, ctx.maxPopularity) * TRAINING_WEIGHTS.popularity;
  const genreVector = new Array(ctx.numGenres).fill(0);
  const genreIdx = ctx.genreIndex[movie.primaryGenre];
  if (Number.isInteger(genreIdx)) {
    genreVector[genreIdx] = TRAINING_WEIGHTS.genre;
  }

  return [popularityFeature, ...genreVector];
};

const buildTrainingContext = ({ users, movies, positiveMap, negativeMap }) => {
  const ages = users.map((u) => u.age);
  const popularityScores = movies.map((m) => m.popularityScore);

  const allGenres = Array.from(new Set(movies.map((m) => m.primaryGenre))).sort();
  const genreIndex = Object.fromEntries(allGenres.map((name, index) => [name, index]));

  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  const minPopularity = Math.min(...popularityScores);
  const maxPopularity = Math.max(...popularityScores);

  return {
    users,
    movies,
    minAge,
    maxAge,
    minPopularity,
    maxPopularity,
    genreIndex,
    numGenres: allGenres.length,
    userDimensions: 1 + allGenres.length,
    movieDimensions: 1 + allGenres.length,
    positiveMap,
    negativeMap
  };
};

const createTrainingData = (ctx) => {
  const movieVectors = new Map();
  for (const movie of ctx.movies) movieVectors.set(movie.id, encodeMovieVector(movie, ctx));

  const inputs = [];
  const labels = [];
  let positiveCount = 0;
  let negativeCount = 0;

  for (const user of ctx.users) {
    const positiveMovies = ctx.positiveMap.get(user.id) || new Set();
    const explicitNegativeMovies = ctx.negativeMap.get(user.id) || new Set();

    const purchasedVectors = Array.from(positiveMovies)
      .map((movieId) => movieVectors.get(movieId))
      .filter(Boolean);

    let userGenreVector;
    if (purchasedVectors.length) {
      userGenreVector = averageVectors(purchasedVectors).slice(1);
    } else {
      userGenreVector = new Array(ctx.numGenres).fill(0);
    }

    const ageFeature = normalize(user.age, ctx.minAge, ctx.maxAge) * TRAINING_WEIGHTS.age;
    const userVector = [ageFeature, ...userGenreVector];

    for (const movie of ctx.movies) {
      const movieVector = movieVectors.get(movie.id);
      const label = positiveMovies.has(movie.id) ? 1 : (explicitNegativeMovies.has(movie.id) ? 0 : 0);

      inputs.push([...userVector, ...movieVector]);
      labels.push(label);

      if (label === 1) positiveCount += 1;
      else negativeCount += 1;
    }
  }

  return {
    xs: tf.tensor2d(inputs),
    ys: tf.tensor2d(labels, [labels.length, 1]),
    inputDimension: ctx.userDimensions + ctx.movieDimensions,
    sampleCount: labels.length,
    positiveCount,
    negativeCount,
    featureMetadata: {
      userDimensions: ctx.userDimensions,
      movieDimensions: ctx.movieDimensions,
      numGenres: ctx.numGenres,
      vectorSchema: 'v2_age_genre_popularity',
      genreIndex: ctx.genreIndex,
      normalization: {
        minAge: ctx.minAge,
        maxAge: ctx.maxAge,
        minPopularity: ctx.minPopularity,
        maxPopularity: ctx.maxPopularity
      }
    }
  };
};

const buildAndTrainModel = async (trainData, options) => {
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [trainData.inputDimension], units: 128, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

  model.compile({
    optimizer: tf.train.adam(options.learningRate),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  const positiveWeight = trainData.positiveCount > 0
    ? trainData.negativeCount / Math.max(1, trainData.positiveCount)
    : 1;

  const history = await model.fit(trainData.xs, trainData.ys, {
    epochs: options.epochs,
    batchSize: options.batchSize,
    shuffle: true,
    validationSplit: options.validationSplit,
    classWeight: { 0: 1, 1: Math.max(1, positiveWeight) }
  });

  const losses = history.history.loss || [];
  const accuracies = history.history.acc || history.history.accuracy || [];
  const valLosses = history.history.val_loss || [];
  const valAccuracies = history.history.val_acc || history.history.val_accuracy || [];
  const epochHistory = Array.from({ length: losses.length }, (_, index) => ({
    epoch: index + 1,
    loss: Number(losses[index] || 0),
    accuracy: Number(accuracies[index] || 0),
    valLoss: Number(valLosses[index] || 0),
    valAccuracy: Number(valAccuracies[index] || 0)
  }));

  return {
    model,
    metrics: {
      loss: Number(losses[losses.length - 1] || 0),
      accuracy: Number(accuracies[accuracies.length - 1] || 0),
      valLoss: Number(valLosses[valLosses.length - 1] || 0),
      valAccuracy: Number(valAccuracies[valAccuracies.length - 1] || 0),
      epochs: options.epochs,
      batchSize: options.batchSize,
      learningRate: options.learningRate,
      validationSplit: options.validationSplit,
      classWeightPositive: Math.max(1, positiveWeight),
      epochHistory
    }
  };
};

const saveModelArtifact = async ({ model, modelName, modelVersion, featureMetadata, metrics }) => {
  const targetDir = path.join(MODELS_DIR, modelName);
  await mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, `${modelVersion}.json`);

  const weightTensors = model.getWeights();
  const weights = [];
  for (const tensor of weightTensors) {
    const values = await tensor.data();
    weights.push({
      name: tensor.name,
      shape: tensor.shape,
      dtype: tensor.dtype,
      values: Array.from(values)
    });
  }

  await writeFile(
    filePath,
    JSON.stringify({
      modelName,
      modelVersion,
      createdAt: new Date().toISOString(),
      architecture: {
        inputDimension: featureMetadata.userDimensions + featureMetadata.movieDimensions,
        hiddenLayers: [128, 64, 32],
        output: 1,
        activation: 'sigmoid'
      },
      featureMetadata,
      metrics,
      weights
    }),
    'utf-8'
  );

  return filePath;
};

const loadTrainingDataset = async (
  client,
  { maxUsers = DEFAULT_MAX_USERS, maxMovies = DEFAULT_MAX_MOVIES, maxGenres = DEFAULT_MAX_GENRES } = {}
) => {
  const safeMaxUsers = Math.max(1, Number.parseInt(maxUsers, 10) || DEFAULT_MAX_USERS);
  const safeMaxMovies = Math.max(6, Number.parseInt(maxMovies, 10) || DEFAULT_MAX_MOVIES);
  const safeMaxGenres = Math.max(1, Number.parseInt(maxGenres, 10) || DEFAULT_MAX_GENRES);
  const moviesPerGenre = Math.max(1, Math.floor(safeMaxMovies / safeMaxGenres));

  const usersResult = await client.query(
    `
      SELECT id, external_id, birth_date
      FROM users
      ORDER BY created_at ASC
      LIMIT $1
    `
    , [safeMaxUsers]
  );

  const moviesResult = await client.query(
    `
      WITH movie_base AS (
        SELECT
          m.id,
          m.external_id,
          m.popularity_score,
          m.title,
          COALESCE(primary_genre.name, 'Unknown') AS primary_genre
        FROM movies m
        LEFT JOIN LATERAL (
          SELECT g.name
          FROM movie_genres mg
          JOIN genres g ON g.id = mg.genre_id
          WHERE mg.movie_id = m.id
          ORDER BY g.name
          LIMIT 1
        ) AS primary_genre ON TRUE
      ),
      top_genres AS (
        SELECT primary_genre
        FROM movie_base
        GROUP BY primary_genre
        HAVING COUNT(*) >= $3
        ORDER BY COUNT(*) DESC, primary_genre
        LIMIT $2
      ),
      ranked AS (
        SELECT
          mb.id,
          mb.external_id,
          mb.popularity_score,
          mb.primary_genre,
          ROW_NUMBER() OVER (
            PARTITION BY mb.primary_genre
            ORDER BY mb.popularity_score DESC, mb.title
          ) AS genre_rank
        FROM movie_base mb
        JOIN top_genres tg ON tg.primary_genre = mb.primary_genre
      )
      SELECT
        id,
        external_id,
        popularity_score,
        primary_genre
      FROM ranked
      WHERE genre_rank <= $3
      ORDER BY popularity_score DESC
      LIMIT $1
    `
    , [safeMaxMovies, safeMaxGenres, moviesPerGenre]
  );

  const distinctGenres = new Set(moviesResult.rows.map((row) => row.primary_genre));
  if (distinctGenres.size < safeMaxGenres || moviesResult.rows.length < safeMaxMovies) {
    throw new Error(
      `Unable to build balanced sample: requested ${safeMaxGenres} genres x ${moviesPerGenre} movies, but got ${distinctGenres.size} genres and ${moviesResult.rows.length} movies.`
    );
  }

  const selectedUserIds = usersResult.rows.map((row) => row.id);
  const selectedMovieIds = moviesResult.rows.map((row) => row.id);

  if (!selectedUserIds.length || !selectedMovieIds.length) {
    return {
      users: [],
      movies: [],
      positiveMap: new Map(),
      negativeMap: new Map(),
      sampleConfig: {
        maxUsers: safeMaxUsers,
        maxMovies: safeMaxMovies,
        maxGenres: safeMaxGenres,
        moviesPerGenre
      }
    };
  }

  const interactionLabelsResult = await client.query(
    `
      SELECT
        ie.user_id,
        ie.movie_id,
        MAX(CASE
          WHEN ie.event_type = 'like' THEN 1
          WHEN ie.event_type = 'watch_complete' THEN 1
          WHEN ie.event_type = 'rating' AND ie.event_value >= 4 THEN 1
          ELSE 0
        END) AS has_positive,
        MAX(CASE
          WHEN ie.event_type = 'skip' THEN 1
          WHEN ie.event_type = 'rating' AND ie.event_value <= 2 THEN 1
          ELSE 0
        END) AS has_negative
      FROM interaction_events ie
      WHERE ie.user_id = ANY($1::uuid[])
        AND ie.movie_id = ANY($2::uuid[])
      GROUP BY ie.user_id, ie.movie_id
    `
    , [selectedUserIds, selectedMovieIds]
  );

  const users = usersResult.rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    age: calculateAge(row.birth_date)
  }));

  const movies = moviesResult.rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    popularityScore: Number(row.popularity_score || 0),
    primaryGenre: row.primary_genre || 'Unknown'
  }));

  const positiveMap = new Map();
  const negativeMap = new Map();
  for (const row of interactionLabelsResult.rows) {
    if (row.has_positive) {
      if (!positiveMap.has(row.user_id)) positiveMap.set(row.user_id, new Set());
      positiveMap.get(row.user_id).add(row.movie_id);
    }
    if (row.has_negative) {
      if (!negativeMap.has(row.user_id)) negativeMap.set(row.user_id, new Set());
      negativeMap.get(row.user_id).add(row.movie_id);
    }
  }

  return {
    users,
    movies,
    positiveMap,
    negativeMap,
    sampleConfig: {
      maxUsers: safeMaxUsers,
      maxMovies: safeMaxMovies,
      maxGenres: safeMaxGenres,
      moviesPerGenre
    }
  };
};

export class ModelTrainingWorker {
  static async train({
    client,
    modelName,
    modelVersion,
    epochs,
    batchSize,
    learningRate,
    validationSplit,
    maxUsers,
    maxMovies,
    maxGenres
  }) {
    await tf.ready();

    const dataset = await loadTrainingDataset(client, { maxUsers, maxMovies, maxGenres });
    if (!dataset.users.length || !dataset.movies.length) {
      throw new Error('Training dataset is empty (users or movies not found).');
    }

    const context = buildTrainingContext(dataset);
    const trainData = createTrainingData(context);

    if (!trainData.positiveCount || !trainData.negativeCount) {
      throw new Error('Insufficient class variety for training (need positive and negative labels).');
    }

    const trained = await buildAndTrainModel(trainData, {
      epochs,
      batchSize,
      learningRate,
      validationSplit
    });

    const metrics = {
      ...trained.metrics,
      sampleCount: trainData.sampleCount,
      positiveCount: trainData.positiveCount,
      negativeCount: trainData.negativeCount,
      positiveRate: Number((trainData.positiveCount / trainData.sampleCount).toFixed(6)),
      inputDimension: trainData.inputDimension,
      users: dataset.users.length,
      movies: dataset.movies.length,
      sampling: dataset.sampleConfig
    };

    const artifactPath = await saveModelArtifact({
      model: trained.model,
      modelName,
      modelVersion,
      featureMetadata: trainData.featureMetadata,
      metrics
    });

    trainData.xs.dispose();
    trainData.ys.dispose();
    trained.model.dispose();

    return { metrics, artifactPath };
  }
}
