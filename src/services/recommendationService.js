export const recommendationQuery = `
  WITH watched_movies AS (
    SELECT DISTINCT ie.movie_id
    FROM interaction_events ie
    WHERE ie.user_id = $1
  ),
  user_genre_scores AS (
    SELECT
      upg.genre_id,
      MAX(upg.affinity_score) AS affinity
    FROM user_preferred_genres upg
    WHERE upg.user_id = $1
    GROUP BY upg.genre_id
  ),
  movie_popularity AS (
    SELECT
      ie.movie_id,
      COALESCE(SUM(ie.event_weight), 0) AS popularity
    FROM interaction_events ie
    GROUP BY ie.movie_id
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
    m.runtime_min,
    m.popularity_score,
    ROUND(maa.audience_avg_age::numeric, 1) AS audience_avg_age,
    COALESCE(STRING_AGG(g.name, ', ' ORDER BY g.name), '') AS genres,
    ROUND(
      (
        COALESCE(MAX(ugs.affinity), 0.0) * 0.65
        + LEAST(1.0, COALESCE(mp.popularity, 0) / 150.0) * 0.25
        + LEAST(1.0, m.popularity_score::float / 100.0) * 0.10
      )::numeric,
      4
    ) AS score
  FROM movies m
  LEFT JOIN movie_genres mg ON mg.movie_id = m.id
  LEFT JOIN genres g ON g.id = mg.genre_id
  LEFT JOIN user_genre_scores ugs ON ugs.genre_id = mg.genre_id
  LEFT JOIN movie_popularity mp ON mp.movie_id = m.id
  LEFT JOIN movie_audience_age maa ON maa.movie_id = m.id
  WHERE m.id NOT IN (SELECT movie_id FROM watched_movies)
  GROUP BY m.id, mp.popularity, maa.audience_avg_age
  ORDER BY score DESC, m.popularity_score DESC, m.title
  LIMIT $2
`;

export const generateRecommendations = async (client, userId, limit) => {
  const result = await client.query(recommendationQuery, [userId, limit]);
  return result.rows;
};
