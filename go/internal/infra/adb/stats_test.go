package adb

import "testing"

func TestParseDeviceStats(t *testing.T) {
	output := `
@@LA_PLUMA_LOAD@@
0.50 0.42 0.38 2/345 12345
@@LA_PLUMA_MEM@@
MemTotal:        8000000 kB
MemFree:          500000 kB
MemAvailable:    2000000 kB
SwapTotal:       1000000 kB
SwapFree:         800000 kB
@@LA_PLUMA_DISK@@
/dev/block/dm-0 30G 20G 10G 67% /data
@@LA_PLUMA_TEMP@@
  temperature: 312
@@LA_PLUMA_TOP@@
Tasks: 1 total, 1 running
400%cpu  10%user 2%sys 388%idle
`
	stats := ParseDeviceStats(output)
	if stats.Load1M == nil || *stats.Load1M != 0.5 {
		t.Fatalf("load1m = %#v", stats.Load1M)
	}
	if stats.CPUPct == nil || *stats.CPUPct != 3 {
		t.Fatalf("cpu = %#v", stats.CPUPct)
	}
	if stats.MemTotalKB != 8000000 || stats.MemUsedKB != 6000000 || stats.MemPct == nil || *stats.MemPct != 75 {
		t.Fatalf("memory = %+v", stats)
	}
	if stats.SwapUsedKB != 200000 {
		t.Fatalf("swap = %+v", stats)
	}
	if stats.DiskPct == nil || *stats.DiskPct != 67 || stats.DiskTotal != "30G" {
		t.Fatalf("disk = %+v", stats)
	}
	if stats.Temp == nil || *stats.Temp != 31 {
		t.Fatalf("temp = %#v", stats.Temp)
	}
}

func TestParseDeviceStatsEmpty(t *testing.T) {
	stats := ParseDeviceStats("")
	if stats.Load1M != nil || stats.CPUPct != nil || stats.MemPct != nil || stats.DiskPct != nil || stats.Temp != nil {
		t.Fatalf("empty output should be nulls: %+v", stats)
	}
}
