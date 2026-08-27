import { createFileRoute, redirect } from '@tanstack/react-router';
import { isCliBackend } from '@/lib/api';
import { RankPage } from '@/pages/RankPage';

export const Route = createFileRoute('/rank')({
  beforeLoad: () => {
    // Community leaderboard is standalone web only (VITE_API_TARGET=server).
    if (isCliBackend()) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: RankPage,
});
