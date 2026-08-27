import { createContext, useContext, type ReactNode } from 'react';
import type { JuejinAuthStatus } from '@/hooks/useJuejinClientLinkFlow';

export interface JuejinAuthContextValue {
  authStatus: JuejinAuthStatus;
  userId: string | null;
  userName: string;
  avatarLarge: string;
}

const JuejinAuthContext = createContext<JuejinAuthContextValue>({
  authStatus: 'unauthenticated',
  userId: null,
  userName: '',
  avatarLarge: '',
});

export function JuejinAuthProvider({
  authStatus,
  userId,
  userName,
  avatarLarge,
  children,
}: JuejinAuthContextValue & { children: ReactNode }) {
  return (
    <JuejinAuthContext.Provider
      value={{ authStatus, userId, userName, avatarLarge }}
    >
      {children}
    </JuejinAuthContext.Provider>
  );
}

export function useJuejinAuth(): JuejinAuthContextValue {
  return useContext(JuejinAuthContext);
}
