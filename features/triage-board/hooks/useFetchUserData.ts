import { githubGraphQLClient } from '../../../utils/api-client';

// Define expected runtime interface returns for structural type safety
interface ViewerDataResponse {
  viewer: {
    login: string;
    avatarUrl: string;
    name: string;
  };
}

const VIEWER_QUERY = `
  query GetAuthedUserContext {
    viewer {
      login
      avatarUrl
      name
    }
  }
`;

export async function fetchAuthenticatedUser() {
  return await githubGraphQLClient<ViewerDataResponse>(VIEWER_QUERY);
}
