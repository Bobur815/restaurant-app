import { formatUzPhoneInput, isUzPhoneComplete, phoneToDigits } from '@shared/utils/phone';
import { field } from './forms';

/**
 * A form field for an Uzbek phone number, masked as typed: "+998 (90) 123-45-67". `digits()` is
 * the 9-digit subscriber number typed so far; `onComplete` fires when all 9 are there (autofill).
 */
export function phoneField(options: {
  name: string;
  label: string;
  value?: string | null;
  onInput?: () => void;
  onComplete?: (digits: string) => void;
}) {
  const el = field({
    name: options.name,
    label: options.label,
    type: 'tel',
    inputmode: 'tel',
    autocomplete: 'off',
  });
  const input = el.querySelector('input')!;
  const typed = () => phoneToDigits(input.value.replace(/^\+998\s*\(?/, ''));
  let last = '';

  const set = (phone: string | null | undefined) => {
    input.value = phone ? formatUzPhoneInput(phone) : '';
    last = typed();
  };
  set(options.value);

  input.addEventListener('focus', () => {
    if (!input.value) input.value = formatUzPhoneInput('');
  });
  input.addEventListener('input', (event) => {
    let digits = typed();
    // Backspace over a mask character (")", " ", "-") removes no digit: take the digit before
    // it, or the mask would put the character straight back and the number could not be erased.
    if ((event as InputEvent).inputType?.startsWith('delete') && digits === last)
      digits = digits.slice(0, -1);
    last = digits;
    input.value = formatUzPhoneInput(digits);
    options.onInput?.();
    if (isUzPhoneComplete(digits)) options.onComplete?.(digits);
  });

  return {
    el,
    input,
    /** The subscriber digits typed so far ('' when empty). */
    digits: typed,
    set,
  };
}
