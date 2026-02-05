import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crop Planner | Plantings',
};

export default function PlantingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
