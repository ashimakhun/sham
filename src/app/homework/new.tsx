import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button, ErrorText, Field, styles } from '@/components/ui';
import { newId } from '@/lib/id';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

export default function NewHomeworkScreen() {
  const { addHomework, currentUser, getUser, courses, courseMembers } = useStore();
  const [courseId, setCourseId] = useState<string>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string>();
  // One id per form: a retry after a network error cannot save the homework twice.
  const [id] = useState(newId);
  const { busy, error, run } = useAction();

  // Only courses I am a listener of (ARU-14; also enforced by RLS). The course owner is its mentor.
  const myCourses = courses.filter((c) => courseMembers.some((m) => m.courseId === c.id && m.userId === currentUser?.id));
  const owner = getUser(myCourses.find((c) => c.id === courseId)?.createdById);

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  function submit() {
    run(async () => {
      if (!courseId) return;
      await addHomework({ id, courseId, title, description, photoUri });
      if (router.canGoBack()) router.back();
      else router.replace('/homework');
    });
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Course</Text>
          {myCourses.length === 0 ? (
            <Text style={styles.body}>You are not in any course yet — ask your teacher or mentor to add you</Text>
          ) : (
            myCourses.map((c) => {
              const selected = c.id === courseId;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setCourseId(c.id)}
                  style={[
                    styles.input,
                    { flexDirection: 'row', alignItems: 'center', gap: 10 },
                    selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                  ]}>
                  <Text style={{ color: selected ? colors.primary : colors.muted, fontSize: 16 }}>
                    {selected ? '●' : '○'}
                  </Text>
                  <Text style={[styles.body, { flex: 1 }]} numberOfLines={2}>
                    {c.title}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
        <Field label="Title" placeholder="e.g. Fractions — exercises 1–10" value={title} onChangeText={setTitle} />
        <Field
          label="Description"
          placeholder="What did you do? Any questions for your mentor?"
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Photo (optional)</Text>
          {photoUri && <Image source={{ uri: photoUri }} style={{ width: '100%', height: 220, borderRadius: 10 }} />}
          <Button title={photoUri ? 'Change photo' : 'Attach a photo'} variant="secondary" onPress={pickPhoto} />
        </View>
        <ErrorText error={error} />
        <Button
          title={busy ? 'Sending…' : 'Send to mentor'}
          onPress={submit}
          disabled={!title.trim() || !courseId || !myCourses.some((c) => c.id === courseId) || busy}
        />
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {owner ? `${owner.name} will check it.` : 'Pick a course to see who will check it.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
