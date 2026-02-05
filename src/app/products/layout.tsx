import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crop Planner | Products',
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
