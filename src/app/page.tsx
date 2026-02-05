import type { Metadata } from 'next';
import SpecExplorer from '@/components/SpecExplorer';
import AppHeader from '@/components/AppHeader';

export const metadata: Metadata = {
  title: 'Crop Planner | Specs',
};

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="h-[calc(100vh-51px)] bg-gray-50">
        <SpecExplorer />
      </main>
    </>
  );
}
