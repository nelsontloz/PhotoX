/// Name part and suffix of [path], split on the last `/` or `\`.
///
/// Both are null when the path names nothing: an empty string, `/`, or a
/// directory path with a trailing separator. The suffix needs a dot after the
/// last separator with a character behind it, so `README`, `.jpg` and `photo.`
/// carry none. Case stays the caller's: a name is shown as stored, an extension
/// is folded.
(String? basename, String? extension) splitFileName(String path) {
  final slash = path.lastIndexOf('/');
  final backslash = path.lastIndexOf('\\');
  final index = slash > backslash ? slash : backslash;
  if (index == path.length - 1) return (null, null);
  final name = path.substring(index + 1);
  final dot = name.lastIndexOf('.');
  return (
    name,
    dot > 0 && dot < name.length - 1 ? name.substring(dot + 1) : null,
  );
}
