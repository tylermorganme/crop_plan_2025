import SpecExplorer from '@/components/SpecExplorer';
import AppHeader from '@/components/AppHeader';

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
