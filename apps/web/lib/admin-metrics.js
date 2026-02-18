export function countActiveAdmins(users) {
  if (!Array.isArray(users)) {
    return 0;
  }

  return users.filter((item) => item?.user?.isAdmin && item?.user?.isActive).length;
}
