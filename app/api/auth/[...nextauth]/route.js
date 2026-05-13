import NextAuth from 'next-auth';
import LinkedInProvider from 'next-auth/providers/linkedin';
import FacebookProvider from 'next-auth/providers/facebook';

const META_SCOPES = [
  'public_profile',
  'ads_read',
  'ads_management',
  'business_management',
].join(',');

export const authOptions = {
  providers: [
    LinkedInProvider({
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      client: { token_endpoint_auth_method: 'client_secret_post' },
      issuer: 'https://www.linkedin.com/oauth',
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
      wellKnown: 'https://www.linkedin.com/oauth/.well-known/openid-configuration',
      authorization: {
        params: {
          scope: 'openid profile email r_ads r_ads_reporting',
        },
      },
      checks: ['state'],
    }),
    FacebookProvider({
      clientId:     process.env.META_APP_ID,
      clientSecret: process.env.META_APP_SECRET,
      authorization: {
        params: {
          scope: META_SCOPES,
          auth_type: 'rerequest',
        },
      },
      token: 'https://graph.facebook.com/v25.0/oauth/access_token',
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account?.provider === 'linkedin' && account?.access_token) {
        token.accessToken = account.access_token;
      }
      if (account?.provider === 'facebook' && account?.access_token) {
        try {
          const exchangeUrl = new URL('https://graph.facebook.com/v25.0/oauth/access_token');
          exchangeUrl.searchParams.set('grant_type',       'fb_exchange_token');
          exchangeUrl.searchParams.set('client_id',        process.env.META_APP_ID);
          exchangeUrl.searchParams.set('client_secret',    process.env.META_APP_SECRET);
          exchangeUrl.searchParams.set('fb_exchange_token', account.access_token);
          const res  = await fetch(exchangeUrl.toString());
          const body = await res.json();
          if (body.access_token) {
            token.metaAccessToken    = body.access_token;
            token.metaTokenExpiresAt = Date.now() + (Number(body.expires_in) || 5_184_000) * 1000;
          } else {
            token.metaAccessToken    = account.access_token;
            token.metaTokenExpiresAt = Date.now() + 60 * 60 * 1000;
          }
        } catch {
          token.metaAccessToken    = account.access_token;
          token.metaTokenExpiresAt = Date.now() + 60 * 60 * 1000;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.metaAccessToken    = token.metaAccessToken    || null;
      session.metaTokenExpiresAt = token.metaTokenExpiresAt || null;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };