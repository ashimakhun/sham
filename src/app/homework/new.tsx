import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Button, ErrorText, Field, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function NewHomeworkScreen() {
  const { addHomework, currentUser, getUser } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string>();
  const { busy, error, run } = useAction();

  const mentor = getUser(currentUser?.mentorId);

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  function submit() {
    run(async () => {
      await addHomework({ title, description, photoUri });
      if (router.canGoBack()) router.back();
      else router.replace('/homework');
    });
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { gap: 16 }]} keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
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
        <Button title={busy ? 'Sending…' : 'Send to mentor'} onPress={submit} disabled={!title.trim() || busy} />
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {mentor ? `${mentor.name} will check it.` : 'You do not have a mentor assigned yet.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
