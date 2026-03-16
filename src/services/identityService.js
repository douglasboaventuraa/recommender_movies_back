export const findUserByIdOrExternalId = async (client, userParam) => {
  const result = await client.query(
    `
      SELECT id, external_id, full_name, email, birth_date, created_at
      FROM users
      WHERE id::text = $1 OR external_id = $1
      LIMIT 1
    `,
    [userParam]
  );

  return result.rows[0] || null;
};

export const findMovieByIdOrExternalId = async (client, movieParam) => {
  const result = await client.query(
    `
      SELECT id, external_id, title, release_date
      FROM movies
      WHERE id::text = $1 OR external_id = $1
      LIMIT 1
    `,
    [movieParam]
  );

  return result.rows[0] || null;
};
