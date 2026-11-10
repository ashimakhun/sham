import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Button, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { formatLimit } from '@/lib/files';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function NewMaterialScreen() {
  const { addMaterial } = useStore();
  const { t, lang } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const { busy, error, run } = useAction();

  function submit() {
    run(async () => {
      await addMaterial({ title, body, link });
      if (router.canGoBack()) router.back();
      else router.replace('/materials');
    });
  }

  return (
    <KeyboardForm>
      <Field label={t('materials.titleLabel')} placeholder={t('materials.titlePlaceholder')} value={title} onChangeText={setTitle} />
      {/* Formatted blog post (ARU-38): stored as Markdown in materials.body, 10,000 characters at most. */}
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>
          {t('materials.contentLabel')}
        </Text>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          placeholder={t('materials.contentPlaceholder')}
          accessibilityLabel={t('materials.contentLabel')}
          limitMessage={t('materials.contentTooLong', { max: formatLimit(10000, lang) })}
        />
      </View>
      <Field
        label={t('materials.linkLabel')}
        placeholder="https://…"
        value={link}
        onChangeText={setLink}
        autoCapitalize="none"
        keyboardType="url"
      />
      <ErrorText error={error} />
      <Button
        title={busy ? t('materials.sharing') : t('materials.shareWithClass')}
        onPress={submit}
        disabled={!title.trim() || !body.trim() || busy}
      />
    </KeyboardForm>
  );
}
