import axios from "axios";

import { FIXTURE_ORIGIN } from "@/lib/fixtureOrigin";

export const apiClient = axios.create({
  baseURL: `${FIXTURE_ORIGIN}/api/v2/`,
  timeout: 10000,
});
