import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import type { ProviderConnectionCredentials } from './connections';

/** API-key clients receive this directly; bearer and basic are request transforms. */
export const providerApiKey = (credentials: ProviderConnectionCredentials | undefined) =>
  credentials?.kind === 'api-key' ? credentials.apiKey : undefined;

/** Apply only the auth modes that native provider clients do not own. */
export const providerAuthTransform = (credentials: ProviderConnectionCredentials | undefined) =>
  (client: HttpClient.HttpClient): HttpClient.HttpClient => {
    if (credentials?.kind === 'basic') {
      return client.pipe(HttpClient.mapRequest((request) => request.pipe(
        HttpClientRequest.basicAuth(credentials.username, credentials.password),
      )));
    }
    if (credentials?.kind === 'oauth2-bearer') {
      return client.pipe(HttpClient.mapRequest((request) => request.pipe(
        HttpClientRequest.bearerToken(credentials.accessToken),
      )));
    }
    return client;
  };
