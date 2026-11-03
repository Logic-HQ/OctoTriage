import { githubGraphQLClient } from '../../../utils/api-client';

export interface RepositoryItem {
  id: string;
  title: string;
  number: number;
  url: string;
  updatedAt: string;
  type: 'PR' | 'ISSUE';
  repoOwner: string;
  repoName: string;
  author: {
    login: string;
    avatarUrl: string;
  };
  labels: Array<{ name: string; color: string }>;
  assigneesCount: number;
  reviewRequestsCount: number;
}

/**
 * Builds and executes a single bulk GraphQL query for all tracked repos.
 */
export async function fetchBulkRepositoryData(
  trackedRepos: Array<{ owner: string; name: string }>
): Promise<RepositoryItem[]> {
  if (trackedRepos.length === 0) return [];

  // 1. Build the dynamic aliases inside the GraphQL query string structure
  let queryBody = '';
  trackedRepos.forEach((repo, index) => {
    queryBody += `
      repo_${index}: repository(owner: "${repo.owner}", name: "${repo.name}") {
        name
        owner { login }
        pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            id
            title
            number
            url
            updatedAt
            author { login avatarUrl }
            labels(first: 6) { nodes { name color } }
            assignees { totalCount }
            reviewRequests { totalCount }
          }
        }
        issues(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            id
            title
            number
            url
            updatedAt
            author { login avatarUrl }
            labels(first: 6) { nodes { name color } }
            assignees { totalCount }
          }
        }
      }
    `;
  });

  const completeQuery = `
    query FetchUnifiedTriageData {
      ${queryBody}
    }
  `;

  // 2. Fire the execution request via our secure API client wrapper
  const rawData = await githubGraphQLClient<Record<string, any>>(completeQuery);

  // 3. Normalize the nested GraphQL data object tree into a flat, clean array
  const normalizedItems: RepositoryItem[] = [];

  Object.keys(rawData).forEach((aliasKey) => {
    const repo = rawData[aliasKey];
    if (!repo) return; // Skip if repository returns null (e.g. not found/typo)

    const repoOwner = repo.owner.login;
    const repoName = repo.name;

    // Process open Pull Requests
    if (repo.pullRequests?.nodes) {
      repo.pullRequests.nodes.forEach((pr: any) => {
        normalizedItems.push({
          id: pr.id,
          title: pr.title,
          number: pr.number,
          url: pr.url,
          updatedAt: pr.updatedAt,
          type: 'PR',
          repoOwner,
          repoName,
          author: {
            login: pr.author?.login || 'ghost',
            avatarUrl: pr.author?.avatarUrl || '',
          },
          labels: pr.labels?.nodes || [],
          assigneesCount: pr.assignees?.totalCount || 0,
          reviewRequestsCount: pr.reviewRequests?.totalCount || 0,
        });
      });
    }

    // Process open Issues
    if (repo.issues?.nodes) {
      repo.issues.nodes.forEach((issue: any) => {
        normalizedItems.push({
          id: issue.id,
          title: issue.title,
          number: issue.number,
          url: issue.url,
          updatedAt: issue.updatedAt,
          type: 'ISSUE',
          repoOwner,
          repoName,
          author: {
            login: issue.author?.login || 'ghost',
            avatarUrl: issue.author?.avatarUrl || '',
          },
          labels: issue.labels?.nodes || [],
          assigneesCount: issue.assignees?.totalCount || 0,
          reviewRequestsCount: 0, // Issues don't have PR review parameters
        });
      });
    }
  });

  return normalizedItems;
}
