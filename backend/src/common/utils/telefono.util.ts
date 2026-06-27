/**
 * Normaliza un número de teléfono al formato internacional sin `+`.
 * Ejemplo: "987654321" → "51987654321"  |  "+51987654321" → "51987654321"
 *
 * @returns E.164 sin `+`, o `null` si la entrada está vacía o solo tiene caracteres inválidos.
 */
export function normalizarTelefono(tel: string, codigoPais = '+51'): string | null {
  if (!tel) return null;
  const clean    = tel.replace(/[^\d+]/g, '');
  if (!clean)    return null;
  const dialCode = codigoPais.replace('+', '');
  if (clean.startsWith('+'))      return clean.slice(1);
  if (clean.startsWith(dialCode)) return clean;
  if (clean.length <= 10)         return `${dialCode}${clean}`;
  return clean;
}
