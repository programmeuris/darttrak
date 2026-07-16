import { TRAINING_VARIANT_LABELS } from '../training';
import type { TrainingVariant } from '../training';

// What each mode trains, shown under its name wherever training can start.
// The "Training ·" prefix keeps the pair recognisable as training modes now
// that neither button carries the word in its name.
const TRAINING_SUBTEXT: Record<TrainingVariant, string> = {
  sink: 'Training · hit every field once',
  group: 'Training · 3 darts per target',
};

const TRAINING_ICONS: Record<TrainingVariant, string> = {
  sink: '🚰',
  group: '🛋️',
};

/** The pair of training start buttons used on Home and the player profile. */
export function TrainingButtons({ onStart }: { onStart: (variant: TrainingVariant) => void }) {
  return (
    <>
      {(['sink', 'group'] as const).map((variant) => (
        <button key={variant} className="btn big training-btn" onClick={() => onStart(variant)}>
          <span>
            {TRAINING_ICONS[variant]} {TRAINING_VARIANT_LABELS[variant]}
          </span>
          <span className="training-sub">{TRAINING_SUBTEXT[variant]}</span>
        </button>
      ))}
    </>
  );
}
