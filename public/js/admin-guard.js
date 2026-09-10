/**
 * Admin Authentication Guard
 * Protects all admin views: hides UI until session is verified and redirects unauthenticated users.
 */
async function protectAdminPage() {
  const isLoginPage = window.location.pathname.endsWith('/admin/index.html') || window.location.pathname.endsWith('/admin/') || window.location.pathname.endsWith('/admin');
  
  try {
    const res = await API.get('/auth/me');
    if (!res || !res.admin) {
      throw new Error('Not authenticated');
    }

    // Authenticated
    const authWrapper = document.getElementById('admin-auth-wrapper');
    if (authWrapper) {
      authWrapper.style.display = 'block';
    }

    const adminUserDisplay = document.getElementById('admin-user-display');
    if (adminUserDisplay) {
      adminUserDisplay.textContent = `Admin: ${res.admin.loginId}`;
    }

    if (isLoginPage) {
      const loginCard = document.getElementById('admin-login-card');
      const dashView = document.getElementById('admin-dashboard-view');
      if (loginCard) loginCard.style.display = 'none';
      if (dashView) dashView.style.display = 'block';
    }

    return res.admin;
  } catch (err) {
    // Unauthenticated
    if (isLoginPage) {
      const loginCard = document.getElementById('admin-login-card');
      const dashView = document.getElementById('admin-dashboard-view');
      if (loginCard) loginCard.style.display = 'block';
      if (dashView) dashView.style.display = 'none';
      const authWrapper = document.getElementById('admin-auth-wrapper');
      if (authWrapper) authWrapper.style.display = 'block';
    } else {
      // Immediately redirect unauthenticated visitors to admin login
      window.location.replace('/admin/index.html');
    }
    return null;
  }
}

async function handleAdminLogout() {
  try {
    await API.post('/auth/logout', {});
  } catch (e) {}
  window.location.replace('/admin/index.html');
}

window.protectAdminPage = protectAdminPage;
window.handleAdminLogout = handleAdminLogout;
