import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

type PickerProps = {
  value: Date;
  mode: 'date';
  display: 'default';
  onChange: (event: { type?: string }, date?: Date) => void;
};

/**
 * Enveloppe **lazy** du sélecteur de date : `import()` dynamique au montage pour
 * éviter l’enregistrement natif `RNCDatePicker` tant que l’utilisateur n’ouvre pas le picker
 * (utile si le dev client n’a pas été regénéré).
 *
 * @param props — Mêmes props que le `DateTimePicker` community (`value`, `mode`, `display`, `onChange`).
 * @returns Indicateur de chargement puis le composant natif une fois le module JS résolu.
 */
export function TimelineDatePickerLazy(props: PickerProps) {
  const [Picker, setPicker] = useState<React.ComponentType<PickerProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('@react-native-community/datetimepicker').then((m) => {
      if (!cancelled) setPicker(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Picker) {
    return (
      <View style={{ padding: 16, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Picker {...props} />;
}
