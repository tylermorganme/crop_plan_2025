'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import { getTimelineCrops, getResources, calculateRowSpan, type TimelineCrop } from '@/lib/timeline-data';
import bedPlanData from '@/data/bed-plan.json';

export default function TimelinePage() {
  const [crops, setCrops] = useState<TimelineCrop[]>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ name: string | null; beds: string[] }[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load data
    const timelineCrops = getTimelineCrops();
    const { resources: res, groups: grps } = getResources();

    setCrops(timelineCrops);
    setResources(res);
    setGroups(grps);
    setLoading(false);
  }, []);

  const handleCropMove = (cropId: string, newResource: string, groupId?: string, bedsNeeded?: number) => {
    // Always calculate span based on bedsNeeded and target row's bed size
    // This handles both multi-bed crops AND single 50ft crops moved to 20ft rows
    const beds = bedsNeeded || 1;

    // Calculate which beds the crop will span in the target row
    const { bedSpanInfo, isComplete, bedsRequired } = calculateRowSpan(
      beds,
      newResource,
      (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups
    );

    // Don't allow the move if there isn't enough room
    if (!isComplete) {
      alert(`Not enough room: this crop needs ${bedsRequired} beds but only ${bedSpanInfo.length} available from ${newResource}`);
      return;
    }

    setCrops(prev => {
      // Find the crop(s) to move - either by groupId or single cropId
      const cropsToRemove = groupId
        ? prev.filter(c => c.groupId === groupId)
        : prev.filter(c => c.id === cropId);

      // Get template from first crop (for dates, name, etc.)
      const template = cropsToRemove[0];
      if (!template) return prev;

      // Remove old entries
      const otherCrops = groupId
        ? prev.filter(c => c.groupId !== groupId)
        : prev.filter(c => c.id !== cropId);

      // Create new entries for each bed in the span
      const newGroupCrops: TimelineCrop[] = bedSpanInfo.map((info, index) => ({
        ...template,
        id: `${template.groupId}_bed${index}`,
        resource: info.bed,
        totalBeds: bedSpanInfo.length,
        bedIndex: index + 1,
        bedsNeeded: beds, // Preserve original bedsNeeded for future moves
        feetUsed: info.feetUsed,
        bedCapacityFt: info.bedCapacityFt,
      }));

      return [...otherCrops, ...newGroupCrops].sort((a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading timeline...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
          ← Back to Explorer
        </Link>
        <h1 className="text-lg font-semibold">Crop Plan Timeline</h1>
        <span className="text-sm text-gray-500">
          {crops.length} crops in plan
        </span>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0">
        <CropTimeline
          crops={crops}
          resources={resources}
          groups={groups}
          onCropMove={handleCropMove}
        />
      </div>
    </div>
  );
}
