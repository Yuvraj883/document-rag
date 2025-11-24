// src/utils/namespace.js

// -----------------------------
// Namespace Derivation
// -----------------------------
export const deriveNamespace = (namespaceValue, organisation) => {
  if (namespaceValue && namespaceValue.trim()) return namespaceValue.trim()
  if (organisation && organisation.trim()) {
    const slug = organisation
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (slug) return slug
  }
  return 'default'
}

