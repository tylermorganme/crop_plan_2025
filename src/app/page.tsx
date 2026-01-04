import { getAllCrops, getUniqueValues } from '@/lib/crops';
import CropExplorer from '@/components/CropExplorer';

export default function Home() {
  const crops = getAllCrops();

  // Get filter options using new field names
  const filterOptions = {
    crops: getUniqueValues('crop'),
    categories: getUniqueValues('category'),
    growingStructures: getUniqueValues('growingStructure'),
  };

  return (
    <main className="h-[calc(100vh-51px)] bg-gray-50">
      <CropExplorer crops={crops} filterOptions={filterOptions} />
    </main>
  );
}
