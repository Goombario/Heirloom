import { query } from '@/lib/db/connection';

/**
 * The one home for `Users` SQL. Auth provisioning (`lib/auth/provision.ts`,
 * `lib/auth/get-user-from-request.ts`), the static build's implicit local user
 * (`lib/data/local-user.ts`), and the sharing service all read/write the table
 * through these helpers — new user statements belong here, not inline.
 */

export interface UserSummary {
    Id: number;
    Email: string;
    Name: string | null;
}

export async function getUserSummaryById(id: number): Promise<UserSummary | null> {
    const result = await query(
        'SELECT "Id", "Email", "Name" FROM "Users" WHERE "Id" = $1',
        [id]
    );
    return (result.rows[0] as UserSummary | undefined) ?? null;
}

export async function getUserSummaryByEmail(email: string): Promise<UserSummary | null> {
    const result = await query(
        'SELECT "Id", "Email", "Name" FROM "Users" WHERE "Email" = $1',
        [email]
    );
    return (result.rows[0] as UserSummary | undefined) ?? null;
}

/**
 * Users whose address matches a normalised one whatever case it was stored in
 * (Google keeps the case it was given), at most two: sharing refuses to guess
 * between two accounts that differ only in case. An exact match would send a
 * differently-cased address of an existing user to a pending share that never applies.
 */
export async function getUserSummariesByNormalizedEmail(email: string): Promise<UserSummary[]> {
    const result = await query(
        'SELECT "Id", "Email", "Name" FROM "Users" WHERE lower("Email") = $1 ORDER BY "Id" LIMIT 2',
        [email]
    );
    return result.rows as UserSummary[];
}

export async function getUserSummaryByGoogleId(googleId: string): Promise<UserSummary | null> {
    const result = await query(
        'SELECT "Id", "Email", "Name" FROM "Users" WHERE "GoogleId" = $1',
        [googleId]
    );
    return (result.rows[0] as UserSummary | undefined) ?? null;
}

/** Attach a GoogleId (and refresh name/image) onto an existing email-only row. */
export async function linkGoogleAccount(
    userId: number,
    googleId: string,
    name: string | null,
    image: string | null
): Promise<void> {
    await query(
        'UPDATE "Users" SET "GoogleId" = $1, "Name" = $2, "Image" = $3 WHERE "Id" = $4',
        [googleId, name, image, userId]
    );
}

export async function insertUser(input: {
    email: string;
    name: string | null;
    image: string | null;
    googleId: string;
}): Promise<UserSummary> {
    const result = await query(
        `INSERT INTO "Users" ("Email", "Name", "Image", "GoogleId")
         VALUES ($1, $2, $3, $4)
         RETURNING "Id", "Email", "Name"`,
        [input.email, input.name, input.image, input.googleId]
    );
    return result.rows[0] as UserSummary;
}
