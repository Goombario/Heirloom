/** Maps a GEDCOM QUAY value to the ui/Badge tone used for its certainty chip. */
export function quayTone(quay: string | null | undefined): 'green' | 'blue' | 'warning' | 'red' | 'neutral' {
  switch (quay) {
    case '3': return 'green';
    case '2': return 'blue';
    case '1': return 'warning';
    case '0': return 'red';
    default: return 'neutral';
  }
}
