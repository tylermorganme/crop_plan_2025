import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crop Planner | Crops',
};

export default function CropsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
