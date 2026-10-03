/** Copied from the GitHub event payload; a field the payload lacks is undefined */
export interface GhaEventData {
  headRef?: string;
  headSha?: string;
  baseRef?: string;
  baseSha?: string;
  issueUrl?: string;
  htmlUrl?: string;
  prTitle?: string;
  senderAvatarUrl?: string;
  senderHtmlUrl?: string;
}

export interface CommitInfo {
  branch: string | null;
  message: string | null;
  email: string | null;
  author: string | null;
  sha: string | null;
  /** seconds since epoch */
  timestamp: string | null;
  /** without credentials */
  remote: string | null;
  ghaEventData?: GhaEventData;
}

export interface CiCommitInfo {
  provider: string | null;
  branch: string | null;
  message: string | null;
  email: string | null;
  author: string | null;
  sha: string | null;
  /** without credentials */
  remote: string | null;
  /** no CI provider sets it */
  timestamp: null;
}

type Env = Record<string, string | undefined>;

export function commitInfo(folder?: string): Promise<CommitInfo>;
export function getCiCommitInfo(env?: Env): CiCommitInfo;
export function detectCiProvider(env?: Env): string | null;
export function removeCredentials<T extends string | null | undefined>(
  url: T
): T;

export function getBranch(folder?: string): Promise<string | null>;
export function getMessage(folder?: string): Promise<string | null>;
export function getEmail(folder?: string): Promise<string | null>;
export function getAuthor(folder?: string): Promise<string | null>;
export function getSha(folder?: string): Promise<string | null>;
export function getRemoteOrigin(folder?: string): Promise<string | null>;
export function getSubject(folder?: string): Promise<string | null>;
export function getTimestamp(folder?: string): Promise<string | null>;
export function getBody(folder?: string): Promise<string | null>;
