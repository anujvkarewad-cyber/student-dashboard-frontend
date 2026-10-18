/**
 * Cross-platform dialogs.
 *
 * `Alert.alert` renders nothing in a browser: react-native-web has no native
 * alert to delegate to, so the call returns immediately and the user sees no
 * dialog at all. That failure is silent, which makes it dangerous - the timer's
 * "Finish" button opened a confirmation that never appeared, so a session could
 * not be ended, and starting a timer with no target did nothing with no
 * explanation.
 *
 * `showDialog` keeps the Alert.alert signature so call sites read the same, and
 * on web falls back to the browser's own confirm/alert. Native behaviour is
 * untouched: Android still gets the real platform dialog.
 */
import { Alert, Platform } from 'react-native';

export type DialogButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

const onWeb = Platform.OS === 'web';

const compose = (title: string, message?: string): string =>
  [title, message].filter(Boolean).join('\n\n');

export const showDialog = (
  title: string,
  message?: string,
  buttons?: DialogButton[],
): void => {
  if (!onWeb) {
    Alert.alert(title, message, buttons as Parameters<typeof Alert.alert>[2]);
    return;
  }

  const scope = globalThis as unknown as {
    confirm?: (text: string) => boolean;
    alert?: (text: string) => void;
  };
  const list = buttons && buttons.length ? buttons : [{ text: 'OK' }];
  const text = compose(title, message);

  if (list.length <= 1) {
    scope.alert?.(text);
    list[0]?.onPress?.();
    return;
  }

  // A web confirm has only two outcomes, so the cancel button owns the false
  // branch and the first non-cancel button owns the true branch.
  const cancel = list.find((button) => button.style === 'cancel');
  const confirm = list.find((button) => button !== cancel) || list[0];

  if (scope.confirm?.(text)) {
    confirm?.onPress?.();
  } else {
    cancel?.onPress?.();
  }
};

/** One-line notice with no decision to make. */
export const showNotice = (title: string, message?: string): void => {
  showDialog(title, message, [{ text: 'OK' }]);
};
