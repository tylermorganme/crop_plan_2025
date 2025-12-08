import { getAllCrops, getMetadata, getUniqueValues, getHeaders } from '@/lib/crops';
import CropExplorer from '@/components/CropExplorer';

export default function Home() {
  const crops = getAllCrops();
  const metadata = getMetadata();
  const allHeaders = getHeaders();

  // Get filter options
  const filterOptions = {
    crops: getUniqueValues('Crop'),
    categories: getUniqueValues('Category'),
    growingStructures: getUniqueValues('Growing Structure'),
    plantingMethods: getUniqueValues('Planting Method'),
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Crop Chart Explorer</h1>
            <p className="text-sm text-gray-500">
              {metadata.totalCrops} planting configurations · {metadata.headerCount} fields
            </p>
          </div>
          <div className="text-xs text-gray-400">
            Data extracted: {new Date(metadata.extractedAt).toLocaleDateString()}
          </div>
        </div>
      </header>

      <div className="px-6 py-6">
        <CropExplorer crops={crops} filterOptions={filterOptions} allHeaders={allHeaders} />
      </div>
    </main>
  );
}
