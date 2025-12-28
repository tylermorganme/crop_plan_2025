import { getAllCrops, getUniqueValues, getHeaders } from '@/lib/crops';
import CropExplorer from '@/components/CropExplorer';

export default function Home() {
  const crops = getAllCrops();
  const allHeaders = getHeaders();

  // Get filter options
  const filterOptions = {
    crops: getUniqueValues('Crop'),
    categories: getUniqueValues('Category'),
    growingStructures: getUniqueValues('Growing Structure'),
    plantingMethods: getUniqueValues('Planting Method'),
  };

  return (
    <main className="h-[calc(100vh-48px)] bg-gray-50">
      <CropExplorer crops={crops} filterOptions={filterOptions} allHeaders={allHeaders} />
    </main>
  );
}
