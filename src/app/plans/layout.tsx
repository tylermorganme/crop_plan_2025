import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crop Planner | Plans',
};

export default function PlansLayout({ children }: { children: React.ReactNode }) {
  return children;
}
