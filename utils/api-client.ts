import { useAppStore } from '../store/useAppStore';

const GITHUB_GRAPHQL_URL = 'https://github.com';

interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * Universal client function to issue standardized, typed requests 
 * to the GitHub GraphQL v4 API.
 */
export async function githubGraphQLClient<T>(
  query: string,
  variables: Record<string, any> = {}
): Promise<T> {
  // Pull the secure runtime session token from the Zustand global store state
  const token = useAppStore.getState().token;

  if (!token) {
    throw new Error('Authentication token missing. Please sign in to your GitHub account.');
  }

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  // Handle baseline HTTP communication protocol errors
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub network layer issue [${response.status}]: ${errorBody || response.statusText}`);
  }

  const payload: GraphQLResponse<T> = await response.json();

  // Handle specific GraphQL structural operational payload query validation issues
  if (payload.errors && payload.errors.length > 0) {
    const primaryErrorMessage = payload.errors[0].message;
    throw new Error(`GitHub GraphQL API processing error: ${primaryErrorMessage}`);
  }

  if (!payload.data) {
    throw new Error('Malformed execution footprint context: Recieved empty response payload data.');
  }

  return payload.data;
}
