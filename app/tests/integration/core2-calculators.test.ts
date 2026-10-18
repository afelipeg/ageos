// Parity of the Core-2 planning calculators with the Python source
// (agency_tools.py, extracted from referencias/agency-erp-all-skills.zip).
// VECTORS were produced by running the source CLI (`python3 -I agency_tools.py
// <tool> < input.json`) on each input below; do not edit by hand.
import {
  audienceMetrics,
  broadcastSpotPlan,
  discountCascade,
  estimateTotalsCalc,
  mediaLineCost,
  planDiff,
  spotMatch,
} from "@/server/calculators/planning"

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Vector = { tool: string; input: Json; output?: Json; error?: string }

const BIGINT_KEYS = new Set(["universe", "volume", "value", "impressions"])
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

function toTs(v: Json, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => toTs(x, key))
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [camel(k), toTs(x, k)]))
  if (typeof v === "number" && (key.endsWith("_minor") || BIGINT_KEYS.has(key) || key === "supplier_commission_value")) return BigInt(v)
  return v
}

function toPy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toPy)
  if (typeof v === "bigint") return Number(v)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [snake(k), toPy(x)]))
  return v
}

const RUN: Record<string, (input: never) => unknown> = {
  media_line_cost: mediaLineCost,
  discount_cascade: discountCascade,
  audience_metrics: audienceMetrics,
  plan_diff: planDiff,
  estimate_totals: estimateTotalsCalc,
  spot_match: spotMatch,
}

const VECTORS: Vector[] = [
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "per_unit",
   "rate_minor": 10000,
   "measure": 1,
   "spots": 20,
   "volume": 0,
   "package_minor": 0
  },
  "output": {
   "currency": "USD",
   "gross_minor": 200000,
   "formula": "rate_per_unit * measure_units * spots"
  }
 },
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "per_second",
   "rate_minor": 333,
   "measure": 30,
   "spots": 20,
   "volume": 0,
   "package_minor": 0
  },
  "output": {
   "currency": "USD",
   "gross_minor": 199800,
   "formula": "rate_per_second * duration_seconds * spots"
  }
 },
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "per_thousand",
   "rate_minor": 1250,
   "measure": 0,
   "spots": 0,
   "volume": 1234567,
   "package_minor": 0
  },
  "output": {
   "currency": "USD",
   "gross_minor": 1543209,
   "formula": "rate * volume / 1000"
  }
 },
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "per_thousand",
   "rate_minor": 1,
   "measure": 0,
   "spots": 0,
   "volume": 500,
   "package_minor": 0
  },
  "output": {
   "currency": "USD",
   "gross_minor": 1,
   "formula": "rate * volume / 1000"
  }
 },
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "per_action",
   "rate_minor": 250,
   "measure": 0,
   "spots": 0,
   "volume": 40,
   "package_minor": 0
  },
  "output": {
   "currency": "USD",
   "gross_minor": 10000,
   "formula": "rate * actions"
  }
 },
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "package",
   "rate_minor": 0,
   "measure": 0,
   "spots": 0,
   "volume": 0,
   "package_minor": 200000
  },
  "output": {
   "currency": "USD",
   "gross_minor": 200000,
   "formula": "package_amount"
  }
 },
 {
  "tool": "media_line_cost",
  "input": {
   "currency": "USD",
   "calc_type": "per_unit",
   "rate_minor": 100,
   "measure": 1,
   "spots": 1,
   "volume": 0,
   "package_minor": 5
  },
  "error": "package_minor must be 0 unless calc_type is package"
 },
 {
  "tool": "discount_cascade",
  "input": {
   "currency": "USD",
   "gross_minor": 100000,
   "mode": "compound",
   "discounts_bps": [
    1000,
    500
   ],
   "surcharges": [],
   "fee_base": "none",
   "fee_bps": 0,
   "fee_discount_bps": 0
  },
  "output": {
   "currency": "USD",
   "surcharged_gross_minor": 100000,
   "steps": [
    {
     "discount_bps": 1000,
     "amount_minor": 10000,
     "running_minor": 90000
    },
    {
     "discount_bps": 500,
     "amount_minor": 4500,
     "running_minor": 85500
    }
   ],
   "net_minor": 85500,
   "fee_minor": 0,
   "client_total_minor": 85500,
   "rounding": "half_up_each_step"
  }
 },
 {
  "tool": "discount_cascade",
  "input": {
   "currency": "USD",
   "gross_minor": 100000,
   "mode": "additive",
   "discounts_bps": [
    1000,
    500
   ],
   "surcharges": [],
   "fee_base": "net",
   "fee_bps": 1500,
   "fee_discount_bps": 1000
  },
  "output": {
   "currency": "USD",
   "surcharged_gross_minor": 100000,
   "steps": [
    {
     "discount_bps": 1000,
     "amount_minor": 10000,
     "running_minor": 90000
    },
    {
     "discount_bps": 500,
     "amount_minor": 5000,
     "running_minor": 85000
    }
   ],
   "net_minor": 85000,
   "fee_minor": 11475,
   "client_total_minor": 96475,
   "rounding": "half_up_each_step"
  }
 },
 {
  "tool": "discount_cascade",
  "input": {
   "currency": "USD",
   "gross_minor": 99999,
   "mode": "compound",
   "discounts_bps": [
    333,
    777,
    1250
   ],
   "surcharges": [
    {
     "kind": "percent",
     "value": 1000,
     "accumulative": false
    },
    {
     "kind": "amount",
     "value": 555,
     "accumulative": false
    },
    {
     "kind": "percent",
     "value": 250,
     "accumulative": true
    }
   ],
   "fee_base": "gross_after_first_discount",
   "fee_bps": 1000,
   "fee_discount_bps": 2500
  },
  "output": {
   "currency": "USD",
   "surcharged_gross_minor": 113318,
   "steps": [
    {
     "discount_bps": 333,
     "amount_minor": 3773,
     "running_minor": 109545
    },
    {
     "discount_bps": 777,
     "amount_minor": 8512,
     "running_minor": 101033
    },
    {
     "discount_bps": 1250,
     "amount_minor": 12629,
     "running_minor": 88404
    }
   ],
   "net_minor": 88404,
   "fee_minor": 8216,
   "client_total_minor": 96620,
   "rounding": "half_up_each_step"
  }
 },
 {
  "tool": "discount_cascade",
  "input": {
   "currency": "USD",
   "gross_minor": 12345,
   "mode": "additive",
   "discounts_bps": [
    3333,
    3333,
    3334
   ],
   "surcharges": [],
   "fee_base": "gross",
   "fee_bps": 500,
   "fee_discount_bps": 0
  },
  "output": {
   "currency": "USD",
   "surcharged_gross_minor": 12345,
   "steps": [
    {
     "discount_bps": 3333,
     "amount_minor": 4115,
     "running_minor": 8230
    },
    {
     "discount_bps": 3333,
     "amount_minor": 4115,
     "running_minor": 4115
    },
    {
     "discount_bps": 3334,
     "amount_minor": 4115,
     "running_minor": 0
    }
   ],
   "net_minor": 0,
   "fee_minor": 617,
   "client_total_minor": 617,
   "rounding": "half_up_each_step"
  }
 },
 {
  "tool": "discount_cascade",
  "input": {
   "currency": "USD",
   "gross_minor": 0,
   "mode": "compound",
   "discounts_bps": [],
   "surcharges": [],
   "fee_base": "gross_after_first_discount",
   "fee_bps": 1000,
   "fee_discount_bps": 0
  },
  "output": {
   "currency": "USD",
   "surcharged_gross_minor": 0,
   "steps": [],
   "net_minor": 0,
   "fee_minor": 0,
   "client_total_minor": 0,
   "rounding": "half_up_each_step"
  }
 },
 {
  "tool": "discount_cascade",
  "input": {
   "currency": "USD",
   "gross_minor": 1000,
   "mode": "additive",
   "discounts_bps": [
    6000,
    5000
   ],
   "surcharges": [],
   "fee_base": "none",
   "fee_bps": 0,
   "fee_discount_bps": 0
  },
  "error": "additive discounts exceed 100%"
 },
 {
  "tool": "audience_metrics",
  "input": {
   "currency": "USD",
   "net_cost_minor": 200000,
   "universe": 1500000,
   "spots": [
    {
     "spot_id": "S001",
     "rating_hundredths": 150
    },
    {
     "spot_id": "S002",
     "rating_hundredths": 175
    },
    {
     "spot_id": "S003",
     "rating_hundredths": 120
    },
    {
     "spot_id": "S004",
     "rating_hundredths": 90
    },
    {
     "spot_id": "S005",
     "rating_hundredths": 210
    },
    {
     "spot_id": "S006",
     "rating_hundredths": 135
    }
   ],
   "reach_hundredths": 3500
  },
  "output": {
   "currency": "USD",
   "trp_hundredths": 880,
   "impressions": 132000,
   "average_rating_hundredths": 147,
   "cpr_minor": 22727,
   "cpm_minor": 1515,
   "frequency_hundredths": 25
  }
 },
 {
  "tool": "audience_metrics",
  "input": {
   "currency": "USD",
   "net_cost_minor": 12345,
   "universe": 987654,
   "spots": [
    {
     "spot_id": "A",
     "rating_hundredths": 333
    },
    {
     "spot_id": "B",
     "rating_hundredths": 1
    }
   ],
   "reach_hundredths": null
  },
  "output": {
   "currency": "USD",
   "trp_hundredths": 334,
   "impressions": 32988,
   "average_rating_hundredths": 167,
   "cpr_minor": 3696,
   "cpm_minor": 374,
   "frequency_hundredths": null
  }
 },
 {
  "tool": "audience_metrics",
  "input": {
   "currency": "USD",
   "net_cost_minor": 5000,
   "universe": 100,
   "spots": [],
   "reach_hundredths": 1000
  },
  "output": {
   "currency": "USD",
   "trp_hundredths": 0,
   "impressions": 0,
   "average_rating_hundredths": null,
   "cpr_minor": null,
   "cpm_minor": null,
   "frequency_hundredths": null
  }
 },
 {
  "tool": "audience_metrics",
  "input": {
   "currency": "USD",
   "net_cost_minor": 5000,
   "universe": 100,
   "spots": [
    {
     "spot_id": "A",
     "rating_hundredths": 10
    },
    {
     "spot_id": "A",
     "rating_hundredths": 20
    }
   ],
   "reach_hundredths": 1000
  },
  "error": "duplicate spot_id"
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 900000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 900000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ]
  },
  "output": {
   "added": [],
   "removed": [],
   "changed": [
    "line_google",
    "line_meta"
   ],
   "unchanged": [
    "line_radio"
   ],
   "currency_deltas": [
    {
     "currency": "USD",
     "before_minor": 2000000,
     "after_minor": 2000000,
     "delta_minor": 0
    }
   ],
   "blockers": [],
   "status": "draft",
   "requires_host_approval": true
  }
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 150000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_ctv",
     "account_id": "none",
     "supplier_id": "dv360_demo",
     "channel": "ctv",
     "currency": "USD",
     "amount_minor": 100000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ]
  },
  "output": {
   "added": [
    "line_ctv"
   ],
   "removed": [],
   "changed": [
    "line_radio"
   ],
   "unchanged": [
    "line_google",
    "line_meta"
   ],
   "currency_deltas": [
    {
     "currency": "USD",
     "before_minor": 2000000,
     "after_minor": 2050000,
     "delta_minor": 50000
    }
   ],
   "blockers": [
    {
     "line_id": "line_radio",
     "reason": "below_commitment"
    }
   ],
   "status": "blocked",
   "requires_host_approval": true
  }
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ]
  },
  "output": {
   "added": [],
   "removed": [
    "line_google",
    "line_radio"
   ],
   "changed": [],
   "unchanged": [
    "line_meta"
   ],
   "currency_deltas": [
    {
     "currency": "USD",
     "before_minor": 2000000,
     "after_minor": 1000000,
     "delta_minor": -1000000
    }
   ],
   "blockers": [
    {
     "line_id": "line_radio",
     "reason": "commitment_removed"
    }
   ],
   "status": "blocked",
   "requires_host_approval": true
  }
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 50000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-04-02"
    },
    {
     "line_id": "line_x",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "CAD",
     "amount_minor": 1,
     "committed_minor": 1,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ]
  },
  "output": {
   "added": [
    "line_x"
   ],
   "removed": [],
   "changed": [
    "line_meta",
    "line_radio"
   ],
   "unchanged": [
    "line_google"
   ],
   "currency_deltas": [
    {
     "currency": "CAD",
     "before_minor": 0,
     "after_minor": 1,
     "delta_minor": 1
    },
    {
     "currency": "USD",
     "before_minor": 2000000,
     "after_minor": 2000000,
     "delta_minor": 0
    }
   ],
   "blockers": [
    {
     "line_id": "line_meta",
     "reason": "commitment_rewritten"
    },
    {
     "line_id": "line_radio",
     "reason": "committed_dimensions_changed"
    },
    {
     "line_id": "line_x",
     "reason": "commitment_rewritten"
    }
   ],
   "status": "blocked",
   "requires_host_approval": true
  }
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": [
    {
     "line_id": "line_meta",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1000000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_google",
     "account_id": "demo_google_aurora",
     "supplier_id": "google_ads",
     "channel": "google",
     "currency": "USD",
     "amount_minor": 800000,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "line_radio",
     "account_id": "none",
     "supplier_id": "offline_file_demo",
     "channel": "radio",
     "currency": "USD",
     "amount_minor": 200000,
     "committed_minor": 200000,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ]
  },
  "output": {
   "added": [],
   "removed": [],
   "changed": [],
   "unchanged": [
    "line_google",
    "line_meta",
    "line_radio"
   ],
   "currency_deltas": [
    {
     "currency": "USD",
     "before_minor": 2000000,
     "after_minor": 2000000,
     "delta_minor": 0
    }
   ],
   "blockers": [],
   "status": "draft",
   "requires_host_approval": false
  }
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "a",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    },
    {
     "line_id": "a",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 2,
     "committed_minor": 0,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": []
  },
  "error": "before: duplicate line_id"
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "a",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1,
     "committed_minor": 2,
     "start_date": "2027-03-16",
     "end_date": "2027-03-31"
    }
   ],
   "after": []
  },
  "error": "before amount is below authoritative commitment"
 },
 {
  "tool": "plan_diff",
  "input": {
   "before": [
    {
     "line_id": "a",
     "account_id": "demo_meta_aurora",
     "supplier_id": "meta_ads",
     "channel": "meta",
     "currency": "USD",
     "amount_minor": 1,
     "committed_minor": 0,
     "start_date": "2027-03-02",
     "end_date": "2027-03-01"
    }
   ],
   "after": []
  },
  "error": "end_date precedes start_date"
 },
 {
  "tool": "estimate_totals",
  "input": {
   "agency_service_bps": 0,
   "agency_service_discount_bps": 0,
   "lines": [
    {
     "line_id": "labor",
     "kind": "internal",
     "currency": "USD",
     "unit_price_minor": 500000,
     "unit_cost_minor": 500000,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": false,
     "supplier_commission_mode": "none",
     "supplier_commission_value": 0
    },
    {
     "line_id": "production",
     "kind": "direct",
     "currency": "USD",
     "unit_price_minor": 550000,
     "unit_cost_minor": 550000,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": false,
     "supplier_commission_mode": "none",
     "supplier_commission_value": 0
    },
    {
     "line_id": "expense",
     "kind": "cost_rendering",
     "currency": "USD",
     "unit_price_minor": 50000,
     "unit_cost_minor": 50000,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": false,
     "supplier_commission_mode": "none",
     "supplier_commission_value": 0
    }
   ]
  },
  "output": {
   "lines": [
    {
     "line_id": "labor",
     "currency": "USD",
     "sale_minor": 500000,
     "cost_minor": 500000,
     "service_minor": 0,
     "supplier_commission_minor": 0,
     "margin_minor": 0
    },
    {
     "line_id": "production",
     "currency": "USD",
     "sale_minor": 550000,
     "cost_minor": 550000,
     "service_minor": 0,
     "supplier_commission_minor": 0,
     "margin_minor": 0
    },
    {
     "line_id": "expense",
     "currency": "USD",
     "sale_minor": 50000,
     "cost_minor": 50000,
     "service_minor": 0,
     "supplier_commission_minor": 0,
     "margin_minor": 0
    }
   ],
   "currency_totals": [
    {
     "currency": "USD",
     "sale_minor": 1100000,
     "cost_minor": 1100000,
     "service_minor": 0,
     "supplier_commission_minor": 0,
     "gross_income_minor": 0
    }
   ],
   "invoice_groups": 1,
   "blockers": []
  }
 },
 {
  "tool": "estimate_totals",
  "input": {
   "agency_service_bps": 1500,
   "agency_service_discount_bps": 1000,
   "lines": [
    {
     "line_id": "a",
     "kind": "indirect",
     "currency": "USD",
     "unit_price_minor": 12345,
     "unit_cost_minor": 10000,
     "quantity": 3,
     "days": 2,
     "discount_bps": 750,
     "service_eligible": true,
     "supplier_commission_mode": "percent",
     "supplier_commission_value": 500
    },
    {
     "line_id": "b",
     "kind": "direct",
     "currency": "USD",
     "unit_price_minor": 1000,
     "unit_cost_minor": 999,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": true,
     "supplier_commission_mode": "none",
     "supplier_commission_value": 0
    },
    {
     "line_id": "c",
     "kind": "internal",
     "currency": "USD",
     "unit_price_minor": 100,
     "unit_cost_minor": 50,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": false,
     "supplier_commission_mode": "fixed",
     "supplier_commission_value": 7
    },
    {
     "line_id": "c",
     "kind": "internal",
     "currency": "USD",
     "unit_price_minor": 1,
     "unit_cost_minor": 1,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": false,
     "supplier_commission_mode": "none",
     "supplier_commission_value": 0
    },
    {
     "line_id": "d",
     "kind": "indirect",
     "currency": "CAD",
     "unit_price_minor": 777,
     "unit_cost_minor": 700,
     "quantity": 1,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": true,
     "supplier_commission_mode": "fixed",
     "supplier_commission_value": 11
    }
   ]
  },
  "output": {
   "lines": [
    {
     "line_id": "a",
     "currency": "USD",
     "sale_minor": 68515,
     "cost_minor": 60000,
     "service_minor": 9249,
     "supplier_commission_minor": 3000,
     "margin_minor": 20764
    },
    {
     "line_id": "b",
     "currency": "USD",
     "sale_minor": 1000,
     "cost_minor": 999,
     "service_minor": 135,
     "supplier_commission_minor": 0,
     "margin_minor": 135
    },
    {
     "line_id": "c",
     "currency": "USD",
     "sale_minor": 100,
     "cost_minor": 50,
     "service_minor": 0,
     "supplier_commission_minor": 7,
     "margin_minor": 57
    },
    {
     "line_id": "d",
     "currency": "CAD",
     "sale_minor": 777,
     "cost_minor": 700,
     "service_minor": 105,
     "supplier_commission_minor": 11,
     "margin_minor": 193
    }
   ],
   "currency_totals": [
    {
     "currency": "CAD",
     "sale_minor": 777,
     "cost_minor": 700,
     "service_minor": 105,
     "supplier_commission_minor": 11,
     "gross_income_minor": 193
    },
    {
     "currency": "USD",
     "sale_minor": 69615,
     "cost_minor": 61049,
     "service_minor": 9384,
     "supplier_commission_minor": 3007,
     "gross_income_minor": 20956
    }
   ],
   "invoice_groups": 2,
   "blockers": [
    {
     "line_id": "b",
     "reason": "direct_sale_differs_from_cost"
    },
    {
     "line_id": "c",
     "reason": "commission_on_internal_line"
    },
    {
     "line_id": "c",
     "reason": "duplicate_line_id"
    }
   ]
  }
 },
 {
  "tool": "estimate_totals",
  "input": {
   "agency_service_bps": 0,
   "agency_service_discount_bps": 0,
   "lines": []
  },
  "output": {
   "lines": [],
   "currency_totals": [],
   "invoice_groups": 0,
   "blockers": []
  }
 },
 {
  "tool": "estimate_totals",
  "input": {
   "agency_service_bps": 0,
   "agency_service_discount_bps": 0,
   "lines": [
    {
     "line_id": "a",
     "kind": "indirect",
     "currency": "USD",
     "unit_price_minor": 0,
     "unit_cost_minor": 0,
     "quantity": 0,
     "days": 1,
     "discount_bps": 0,
     "service_eligible": false,
     "supplier_commission_mode": "none",
     "supplier_commission_value": 0
    }
   ]
  },
  "output": {
   "lines": [
    {
     "line_id": "a",
     "currency": "USD",
     "sale_minor": 0,
     "cost_minor": 0,
     "service_minor": 0,
     "supplier_commission_minor": 0,
     "margin_minor": 0
    }
   ],
   "currency_totals": [
    {
     "currency": "USD",
     "sale_minor": 0,
     "cost_minor": 0,
     "service_minor": 0,
     "supplier_commission_minor": 0,
     "gross_income_minor": 0
    }
   ],
   "invoice_groups": 0,
   "blockers": []
  }
 },
 {
  "tool": "spot_match",
  "input": {
   "tolerance_minutes": 10,
   "match_material": true,
   "ordered": [
    {
     "spot_id": "S1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S2",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "16:00",
     "window_end": "19:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S3",
     "station_id": "FCR",
     "air_date": "2027-03-17",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S4",
     "station_id": "FCR",
     "air_date": "2027-03-17",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S5",
     "station_id": "FCR",
     "air_date": "2027-03-18",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    }
   ],
   "aired": [
    {
     "event_id": "E1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "07:15",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E2",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "19:05",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E3",
     "station_id": "FCR",
     "air_date": "2027-03-17",
     "air_time": "08:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E4",
     "station_id": "FCR",
     "air_date": "2027-03-17",
     "air_time": "09:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E5",
     "station_id": "FCR",
     "air_date": "2027-03-18",
     "air_time": "07:00",
     "material_id": "other"
    },
    {
     "event_id": "E6",
     "station_id": "FCR",
     "air_date": "2027-03-19",
     "air_time": "07:00",
     "material_id": "mat_fcr_30s"
    }
   ]
  },
  "output": {
   "matches": [
    {
     "spot_id": "S1",
     "event_id": "E1",
     "kind": "exact"
    },
    {
     "spot_id": "S2",
     "event_id": "E2",
     "kind": "tolerance"
    }
   ],
   "ambiguous": [
    {
     "spot_id": "S3",
     "candidate_event_ids": [
      "E3",
      "E4"
     ]
    },
    {
     "spot_id": "S4",
     "candidate_event_ids": [
      "E3",
      "E4"
     ]
    }
   ],
   "ordered_not_aired": [
    "S5"
   ],
   "aired_not_ordered": [
    "E5",
    "E6"
   ]
  }
 },
 {
  "tool": "spot_match",
  "input": {
   "tolerance_minutes": 0,
   "match_material": false,
   "ordered": [
    {
     "spot_id": "S1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S2",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    }
   ],
   "aired": [
    {
     "event_id": "E1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "07:15",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E2",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E3",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "10:01",
     "material_id": "mat_fcr_30s"
    }
   ]
  },
  "output": {
   "matches": [],
   "ambiguous": [
    {
     "spot_id": "S1",
     "candidate_event_ids": [
      "E1",
      "E2"
     ]
    },
    {
     "spot_id": "S2",
     "candidate_event_ids": [
      "E1",
      "E2"
     ]
    }
   ],
   "ordered_not_aired": [],
   "aired_not_ordered": [
    "E3"
   ]
  }
 },
 {
  "tool": "spot_match",
  "input": {
   "tolerance_minutes": 5,
   "match_material": true,
   "ordered": [
    {
     "spot_id": "S1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S2",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    },
    {
     "spot_id": "S3",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "06:00",
     "window_end": "10:00",
     "material_id": "mat_fcr_30s"
    }
   ],
   "aired": [
    {
     "event_id": "E1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "07:15",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E2",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "08:15",
     "material_id": "mat_fcr_30s"
    }
   ]
  },
  "output": {
   "matches": [],
   "ambiguous": [
    {
     "spot_id": "S1",
     "candidate_event_ids": [
      "E1",
      "E2"
     ]
    },
    {
     "spot_id": "S2",
     "candidate_event_ids": [
      "E1",
      "E2"
     ]
    },
    {
     "spot_id": "S3",
     "candidate_event_ids": [
      "E1",
      "E2"
     ]
    }
   ],
   "ordered_not_aired": [],
   "aired_not_ordered": []
  }
 },
 {
  "tool": "spot_match",
  "input": {
   "tolerance_minutes": 5,
   "match_material": true,
   "ordered": [
    {
     "spot_id": "S1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "window_start": "10:00",
     "window_end": "06:00",
     "material_id": "mat_fcr_30s"
    }
   ],
   "aired": []
  },
  "error": "window_end precedes window_start; split windows that cross midnight"
 },
 {
  "tool": "spot_match",
  "input": {
   "tolerance_minutes": 5,
   "match_material": true,
   "ordered": [],
   "aired": [
    {
     "event_id": "E1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "07:15",
     "material_id": "mat_fcr_30s"
    },
    {
     "event_id": "E1",
     "station_id": "FCR",
     "air_date": "2027-03-16",
     "air_time": "07:16",
     "material_id": "mat_fcr_30s"
    }
   ]
  },
  "error": "duplicate event_id"
 }
]

describe("planning calculators match agency_tools.py", () => {
  it.each(VECTORS.map((v, i) => [`${v.tool} #${i}`, v] as const))("%s", (_label, v) => {
    const run = () => RUN[v.tool]!(toTs(v.input) as never)
    if (v.error) {
      expect(run).toThrow(v.error)
    } else {
      expect(toPy(run())).toEqual(v.output)
    }
  })

  it("covers all six ported calculators", () => {
    expect(new Set(VECTORS.map((v) => v.tool))).toEqual(new Set(Object.keys(RUN)))
  })
})

describe("contract cases", () => {
  it("successive 10% and 5% discounts on 1,000 yield 855", () => {
    const r = discountCascade({ currency: "USD", grossMinor: 100000n, mode: "compound", discountsBps: [1000, 500], surcharges: [], feeBase: "none", feeBps: 0, feeDiscountBps: 0 })
    expect(r.netMinor).toBe(85500n)
  })

  it("20 radio spots at 100 cost 2,000 and the spot register has unique ids", () => {
    expect(mediaLineCost({ currency: "USD", calcType: "per_unit", rateMinor: 10000n, measure: 1, spots: 20, volume: 0n, packageMinor: 0n }).grossMinor).toBe(200000n)
    const plan = broadcastSpotPlan({ stationCode: "FCR", spotCount: 20, durationSeconds: 30, flightStart: "2027-03-16", flightEnd: "2027-03-31", dayparts: [{ code: "AM", start: "06:00", end: "10:00" }, { code: "PM", start: "16:00", end: "19:00" }] })
    expect(plan).toHaveLength(20)
    expect(new Set(plan.map((s) => s.spotId)).size).toBe(20)
    expect(plan[0]!.airDate).toBe("2027-03-16")
    expect(plan[19]!.airDate).toBe("2027-03-31")
    expect(broadcastSpotPlan({ stationCode: "FCR", spotCount: 20, durationSeconds: 30, flightStart: "2027-03-16", flightEnd: "2027-03-31", dayparts: [{ code: "AM", start: "06:00", end: "10:00" }] })).toEqual(
      broadcastSpotPlan({ stationCode: "FCR", spotCount: 20, durationSeconds: 30, flightStart: "2027-03-16", flightEnd: "2027-03-31", dayparts: [{ code: "AM", start: "06:00", end: "10:00" }] })
    )
  })

  it("Aurora reallocation keeps the 30,000 total and flags no blockers", () => {
    const line = (lineId: string, amountMinor: bigint) => ({ lineId, accountId: "none", supplierId: "x", channel: lineId, currency: "USD", amountMinor, committedMinor: 0n, startDate: "2027-03-16", endDate: "2027-03-31" })
    const d = planDiff({ before: [line("meta", 1000000n), line("google", 800000n), line("rest", 1200000n)], after: [line("meta", 900000n), line("google", 900000n), line("rest", 1200000n)] })
    expect(d.currencyDeltas).toEqual([{ currency: "USD", beforeMinor: 3000000n, afterMinor: 3000000n, deltaMinor: 0n }])
    expect(d.changed).toEqual(["google", "meta"])
    expect(d.status).toBe("draft")
  })

  it("rejects unknown keys like the strict source schema", () => {
    expect(() => mediaLineCost({ currency: "USD", calcType: "package", rateMinor: 0n, measure: 0, spots: 0, volume: 0n, packageMinor: 1n, extra: 1 } as never)).toThrow()
  })
})
