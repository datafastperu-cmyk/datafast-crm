import {
  useId,
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

interface FormFieldBase {
  label:       string;
  error?:      string;
  helperText?: string;
  required?:   boolean;
  className?:  string;
}

interface FormFieldInputProps
  extends FormFieldBase,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'> {
  as?: 'input';
}

interface FormFieldTextareaProps
  extends FormFieldBase,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required'> {
  as: 'textarea';
}

export type FormFieldProps = FormFieldInputProps | FormFieldTextareaProps;

const inputBase = [
  'w-full rounded-lg border bg-background px-3 py-2 text-sm',
  'placeholder:text-muted-foreground',
  'transition-colors duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export function FormField(props: FormFieldProps) {
  const { label, error, helperText, required, className, as = 'input', ...inputProps } = props;

  const baseId   = useId();
  const errorId  = error      ? `${baseId}-error`  : undefined;
  const helperId = helperText ? `${baseId}-helper` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

  const fieldClasses = cn(inputBase, error ? 'border-destructive focus-visible:ring-destructive' : 'border-input');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={baseId}
        className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-destructive">*</span>
        )}
      </label>

      {as === 'textarea' ? (
        <textarea
          {...(inputProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          id={baseId}
          required={required}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(fieldClasses, 'min-h-[80px] resize-y')}
        />
      ) : (
        <input
          {...(inputProps as InputHTMLAttributes<HTMLInputElement>)}
          id={baseId}
          required={required}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={fieldClasses}
        />
      )}

      {helperText && !error && (
        <p id={helperId} className="text-xs text-muted-foreground">
          {helperText}
        </p>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive flex items-center gap-1">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}
