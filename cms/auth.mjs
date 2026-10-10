import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { PostgresDialect } from 'kysely';
import { createPool } from './db.mjs';
import { assertOrigin, cookiesAfterResponse, HttpError } from './http.mjs';

const publicRoutes = new Map([
  ['/sign-in/email', 'POST'], ['/sign-out', 'POST'], ['/get-session', 'GET'],
  ['/two-factor/verify-totp', 'POST'], ['/two-factor/verify-backup-code', 'POST'],
]);
const ownerRoutes = new Set([
  '/change-password', '/two-factor/generate-backup-codes', '/two-factor/get-totp-uri',
]);

export function authRouteAllowed(path, method) {
  return publicRoutes.get(path) === method ||
    (method === 'POST' && (path === '/two-factor/enable' || ownerRoutes.has(path)));
}

export function createAuth(config, { database } = {}) {
  return betterAuth({
    appName: 'Ray’s website',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.authSecret,
    database: database || {
      dialect: new PostgresDialect({ pool: createPool(config.databaseUrl) }),
      type: 'postgres', schemaName: 'cms_auth', transaction: true,
    },
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true,
      // The only sign-up entry point is the token-protected internal bootstrap.
      // /sign-up/email is never forwarded by handleAuth.
      disableSignUp: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      additionalFields: {
        mfaVerified: { type: 'boolean', defaultValue: false, input: false },
      },
    },
    advanced: {
      useSecureCookies: config.secureCookies,
      cookiePrefix: 'ray-cms',
      defaultCookieAttributes: { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-nf-client-connection-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: { before: async (user) => {
          if (user.email.toLowerCase() !== config.ownerEmail) {
            throw new APIError('FORBIDDEN', { message: 'Only the website administrator can have an account.' });
          }
          return { data: { ...user, email: config.ownerEmail } };
        } },
      },
    },
    plugins: [twoFactor({ issuer: 'Ray’s website', trustDeviceMaxAge: 30 * 24 * 60 * 60 })],
  });
}

export async function requireOwner(request, auth, config, { allowEnrollment = false } = {}) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.email.toLowerCase() !== config.ownerEmail) {
    throw new HttpError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
  }
  if (!session.user.twoFactorEnabled) {
    if (allowEnrollment) return session;
    throw new HttpError(403, 'MFA_ENROLLMENT_REQUIRED', 'Set up and verify two-factor authentication first.');
  }
  if (!session.session.mfaVerified) {
    throw new HttpError(403, 'MFA_REQUIRED', 'Complete two-factor authentication to continue.');
  }
  return session;
}

export async function handleAuth(request, auth, config) {
  assertOrigin(request, config.origin);
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, '');
  if (!authRouteAllowed(path, request.method)) {
    throw new HttpError(404, 'NOT_FOUND', 'This authentication method is unavailable.');
  }
  if (path === '/two-factor/enable') {
    const session = await requireOwner(request, auth, config, { allowEnrollment: true });
    if (session.user.twoFactorEnabled) throw new HttpError(409, 'ALREADY_ENROLLED', 'Two-factor authentication is already enabled.');
  } else if (ownerRoutes.has(path)) {
    await requireOwner(request, auth, config);
  }
  const response = await auth.handler(request);
  if (response.ok && ['/sign-in/email', '/two-factor/verify-totp', '/two-factor/verify-backup-code'].includes(path)) {
    const headers = cookiesAfterResponse(request, response);
    const session = await auth.api.getSession({ headers });
    if (session?.user.email.toLowerCase() === config.ownerEmail && session.user.twoFactorEnabled) {
      // Mark only this specific session after the library completed its MFA flow.
      // Password-only sessions created before enrollment stay blocked forever.
      const context = await auth.$context;
      await context.internalAdapter.updateSession(session.session.token, { mfaVerified: true });
    }
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
