const assert = require('assert');

// Simulate state
let selectedSegmentId = 'id2';
let clips = [
  { id: 'id1', name: 'Segment 1' },
  { id: 'id2', name: 'Segment 2' },
  { id: 'id3', name: 'Segment 3' },
];

function setClips(newClips) { clips = newClips; }
function setSelectedSegmentId(newId) { selectedSegmentId = newId; }

const handleDeleteSegment = () => {
  if (!selectedSegmentId) return;
  const targetSeg = clips.find((c) => c.id === selectedSegmentId);
  if (!targetSeg) return;

  const confirmDelete = true; // simulate user clicking OK
  if (!confirmDelete) return;

  const deletedIndex = clips.findIndex((c) => c.id === selectedSegmentId);
  const updated = clips.filter((c) => c.id !== selectedSegmentId);
  setClips(updated);

  if (updated.length > 0) {
    const nextSelect = updated[Math.min(deletedIndex, updated.length - 1)];
    setSelectedSegmentId(nextSelect.id);
  } else {
    setSelectedSegmentId(null);
  }
};

try {
  handleDeleteSegment();
  console.log("Delete 1 successful. clips:", clips.map(c=>c.id), "selected:", selectedSegmentId);
  
  // Try deleting the last remaining segment
  handleDeleteSegment();
  console.log("Delete 2 successful. clips:", clips.map(c=>c.id), "selected:", selectedSegmentId);
  
  handleDeleteSegment();
  console.log("Delete 3 successful. clips:", clips.map(c=>c.id), "selected:", selectedSegmentId);
} catch (e) {
  console.error("Error:", e);
}
