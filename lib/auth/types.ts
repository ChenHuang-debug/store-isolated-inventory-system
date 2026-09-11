export type StoreAccess = {
  id: string;
  code: string;
  name: string;
  permissions: string[];
};

export type AuthSession = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  isSystemAdmin: boolean;
  absoluteExpiresAt: Date;
  stores: StoreAccess[];
  tokenHash: string;
};
