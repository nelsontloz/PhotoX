import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

export const healthApi = axios.create({
  timeout: 5000,
})
