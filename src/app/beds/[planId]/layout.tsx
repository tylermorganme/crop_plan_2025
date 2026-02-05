import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crop Planner | Beds',
};

export default function BedsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
