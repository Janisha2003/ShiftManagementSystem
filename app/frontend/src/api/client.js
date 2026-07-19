import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // Proxied via Vite config in local dev environment
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Automatically injects authorization header
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Catches session expiration errors
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear storage and reload session on unauthorized tokens
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default client;
