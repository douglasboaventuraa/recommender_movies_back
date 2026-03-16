import pg from 'pg';
import { readFile } from 'fs/promises';

const TRAINING_WEIGHTS = {
  runtime: 0.15,
  popularity: 0.2,
  releaseYear: 0.1,
  audienceAge: 0.15,
  genres: 0.4,
  userAge: 0.2
};

const normalize = (value, min, max) => {
  const safeValue = Number.isFinite(value) ? value : min;
  return (safeValue - min) / ((max - min) || 1);
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const calculateAge = (birthDate) => {
  if (!birthDate) return 30;
  const now = new Date();
  const birth = new Date(birthDate);
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

const cosineSimilarity = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
};

const encodeMovieVector = (movie, featureMetadata) => {
  const n = featureMetadata.normalization;
  const genreIndex = featureMetadata.genreIndex;
  const numGenres = featureMetadata.numGenres;

  const runtimeFeature = normalize(movie.runtime_min, n.minRuntime, n.maxRuntime) * TRAINING_WEIGHTS.runtime;
  const popularityFeature = normalize(Number(movie.popularity_score || 0), n.minPopularity, n.maxPopularity) * TRAINING_WEIGHTS.popularity;
  const releaseFeature = normalize(movie.release_year, n.minReleaseYear, n.maxReleaseYear) * TRAINING_WEIGHTS.releaseYear;
  const audienceAgeFeature = 0.5 * TRAINING_WEIGHTS.audienceAge;

  const genreVector = new Array(numGenres).fill(0);
  for (const g of movie.genres || []) {
    const idx = genreIndex[g];
    if (Number.isInteger(idx)) genreVector[idx] = TRAINING_WEIGHTS.genres;
  }

  return {
    vector: [runtimeFeature, popularityFeature, releaseFeature, audienceAgeFeature, ...genreVector],
    components: {
      runtimeRaw: movie.runtime_min,
      runtimeNorm: normalize(movie.runtime_min, n.minRuntime, n.maxRuntime),
      popularityRaw: Number(movie.popularity_score || 0),
      popularityNorm: normalize(Number(movie.popularity_score || 0), n.minPopularity, n.maxPopularity),
      releaseYearRaw: movie.release_year,
      releaseYearNorm: normalize(movie.release_year, n.minReleaseYear, n.maxReleaseYear)
    }
  };
};

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'smartshop_recommender',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres'
});

const run = async () => {
  const activeModel = await pool.query(`
    SELECT storage_uri, model_name, model_version
    FROM model_registry
    WHERE is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const model = activeModel.rows[0];
  if (!model) throw new Error('No active model found');

  const artifact = JSON.parse(await readFile(model.storage_uri, 'utf-8'));
  const fm = artifact.featureMetadata;

  const userRes = await pool.query(`
    SELECT id, external_id, full_name, birth_date
    FROM users
    ORDER BY full_name
    LIMIT 1
  `);
  const user = userRes.rows[0];

  const recRes = await fetch(`http://localhost:8080/api/recommendations/${user.id}?limit=8`);
  const rec = await recRes.json();

  const topMovieId = rec.recommendations[0].id;
  const lowMovieId = rec.recommendations[rec.recommendations.length - 1].id;

  const movieRows = await pool.query(
    `
      SELECT
        m.id,
        m.title,
        m.runtime_min,
        m.popularity_score,
        EXTRACT(YEAR FROM m.release_date)::int AS release_year,
        COALESCE(ARRAY_AGG(g.name ORDER BY g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres
      FROM movies m
      LEFT JOIN movie_genres mg ON mg.movie_id = m.id
      LEFT JOIN genres g ON g.id = mg.genre_id
      WHERE m.id = ANY($1::uuid[])
      GROUP BY m.id
    `,
    [[topMovieId, lowMovieId]]
  );

  const posRows = await pool.query(
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
    [user.id]
  );

  const posIds = posRows.rows.map((r) => r.movie_id);
  const posMovies = await pool.query(
    `
      SELECT
        m.id,
        m.runtime_min,
        m.popularity_score,
        EXTRACT(YEAR FROM m.release_date)::int AS release_year,
        COALESCE(ARRAY_AGG(g.name ORDER BY g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres
      FROM movies m
      LEFT JOIN movie_genres mg ON mg.movie_id = m.id
      LEFT JOIN genres g ON g.id = mg.genre_id
      WHERE m.id = ANY($1::uuid[])
      GROUP BY m.id
    `,
    [posIds.length ? posIds : ['00000000-0000-0000-0000-000000000000']]
  );

  const posVectors = posMovies.rows.map((m) => encodeMovieVector(m, fm).vector);
  const ageNorm = normalize(calculateAge(user.birth_date), fm.normalization.minAge, fm.normalization.maxAge);
  const userVector = posVectors.length
    ? averageVectors(posVectors)
    : [0, 0, 0, ageNorm * TRAINING_WEIGHTS.userAge, ...new Array(fm.numGenres).fill(0)];

  userVector[3] = clamp((userVector[3] + (ageNorm * TRAINING_WEIGHTS.userAge)) / 2);

  const movieMap = new Map(movieRows.rows.map((m) => [m.id, m]));

  const topMovie = movieMap.get(topMovieId);
  const lowMovie = movieMap.get(lowMovieId);

  const topEnc = encodeMovieVector(topMovie, fm);
  const lowEnc = encodeMovieVector(lowMovie, fm);

  const topCos = cosineSimilarity(userVector, topEnc.vector);
  const lowCos = cosineSimilarity(userVector, lowEnc.vector);

  console.log(JSON.stringify({
    training: {
      modelName: model.model_name,
      modelVersion: model.model_version,
      metrics: artifact.metrics,
      normalization: fm.normalization,
      numGenres: fm.numGenres,
      inputDimension: artifact.architecture.inputDimension
    },
    user: {
      id: user.id,
      externalId: user.external_id,
      fullName: user.full_name,
      ageNorm
    },
    topRecommendation: {
      id: topMovie.id,
      title: topMovie.title,
      apiScore: rec.recommendations[0].score,
      cosineToUserProfile: topCos,
      components: topEnc.components,
      genres: topMovie.genres
    },
    lowerRecommendation: {
      id: lowMovie.id,
      title: lowMovie.title,
      apiScore: rec.recommendations[rec.recommendations.length - 1].score,
      cosineToUserProfile: lowCos,
      components: lowEnc.components,
      genres: lowMovie.genres
    }
  }, null, 2));

  await pool.end();
};

run().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
