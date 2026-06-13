const appJson = require('./app.json');

const expoConfig = appJson.expo;
const referralHost = resolveReferralHost(process.env.EXPO_PUBLIC_WEB_ORIGIN);

module.exports = {
  expo: {
    ...expoConfig,
    ios: {
      ...(expoConfig.ios ?? {}),
      ...(referralHost ? { associatedDomains: [`applinks:${referralHost}`] } : {}),
    },
    android: {
      ...(expoConfig.android ?? {}),
      ...(referralHost
        ? {
            intentFilters: [
              ...((expoConfig.android ?? {}).intentFilters ?? []),
              {
                action: 'VIEW',
                autoVerify: true,
                category: ['BROWSABLE', 'DEFAULT'],
                data: [
                  {
                    host: referralHost,
                    pathPrefix: '/r',
                    scheme: 'https',
                  },
                ],
              },
            ],
          }
        : {}),
    },
  },
};

function resolveReferralHost(origin) {
  const trimmedOrigin = origin?.trim();

  if (!trimmedOrigin) {
    return null;
  }

  try {
    return new URL(trimmedOrigin).host;
  } catch {
    return null;
  }
}
