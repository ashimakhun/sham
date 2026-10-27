import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { HomeworkCard } from '@/components/HomeworkCard';
import { Button, EmptyState, Segmented, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { HomeworkStatus } from '@/lib/types';

type Filter = 'all' | HomeworkStatus;

const emptyText: Record<string, { title: string; hint: string }> = {
  student: { title: 'No homework yet', hint: 'Tap "Add homework" to send your work to your mentor.' },
  mentor: { title: 'Nothing here', hint: 'Homework from your students will appear here.' },
  teacher: { title: 'No homework yet', hint: 'Student submissions will appear here.' },
};

export default function HomeworkScreen() {
  const { currentUser, visibleHomework } = useStore();
  const role = currentUser?.role ?? 'student';
  // Mentors land on what still needs checking; others see everything.
  const [filter, setFilter] = useState<Filter>(role === 'mentor' ? 'submitted' : 'all');

  const data = filter === 'all' ? visibleHomework : visibleHomework.filter((h) => h.status === filter);
  const waiting = visibleHomework.filter((h) => h.status === 'submitted').length;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={data}
      keyExtractor={(h) => h.id}
      renderItem={({ item }) => <HomeworkCard item={item} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {role === 'student' && <Button title="+ Add homework" onPress={() => router.push('/homework/new')} />}
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'submitted', label: `To check (${waiting})` },
              { value: 'checked', label: 'Checked' },
              { value: 'all', label: 'All' },
            ]}
          />
        </View>
      }
      ListEmptyComponent={<EmptyState {...emptyText[role]} />}
    />
  );
}
