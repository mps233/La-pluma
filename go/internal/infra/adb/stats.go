package adb

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// DeviceStats mirrors the Node /api/agent/device-stats snapshot. Pointers keep
// absent measurements null instead of inventing zeroes.
type DeviceStats struct {
	Load1M  *float64 `json:"load1m"`
	Load5M  *float64 `json:"load5m"`
	Load15M *float64 `json:"load15m"`
	CPUPct  *int     `json:"cpuPct"`

	MemTotalKB int    `json:"memTotalKb"`
	MemUsedKB  int    `json:"memUsedKb"`
	MemFreeKB  int    `json:"memFreeKb"`
	MemTotal   string `json:"memTotal"`
	MemUsed    string `json:"memUsed"`
	MemFree    string `json:"memFree"`
	MemPct     *int   `json:"memPct"`

	SwapTotalKB int `json:"swapTotalKb"`
	SwapUsedKB  int `json:"swapUsedKb"`

	DiskTotal string `json:"diskTotal"`
	DiskUsed  string `json:"diskUsed"`
	DiskFree  string `json:"diskFree"`
	DiskPct   *int   `json:"diskPct"`
	Temp      *int   `json:"temp"`
}

const (
	markerLoad = "@@LA_PLUMA_LOAD@@"
	markerMem  = "@@LA_PLUMA_MEM@@"
	markerDisk = "@@LA_PLUMA_DISK@@"
	markerTemp = "@@LA_PLUMA_TEMP@@"
	markerTop  = "@@LA_PLUMA_TOP@@"
)

var (
	topCPU   = regexp.MustCompile(`(\d+)%cpu`)
	topIdle  = regexp.MustCompile(`(\d+)%idle`)
	memLine  = regexp.MustCompile(`^(\w+):\s+(\d+)`)
	tempLine = regexp.MustCompile(`temperature:\s*(\d+)`)
)

func (c *Client) DeviceStats(ctx context.Context, serial string) (*DeviceStats, error) {
	script := strings.Join([]string{
		"echo " + markerLoad,
		"cat /proc/loadavg",
		"echo " + markerMem,
		"cat /proc/meminfo | head -4",
		"echo " + markerDisk,
		"df -h /data | tail -1",
		"echo " + markerTemp,
		"dumpsys battery | grep temperature",
		"echo " + markerTop,
		"top -b -n 1 -d 0.3 | head -5",
	}, "; ")
	output, err := c.Shell(ctx, serial, script)
	if err != nil {
		return nil, err
	}
	return ParseDeviceStats(output), nil
}

func ParseDeviceStats(output string) *DeviceStats {
	loadRaw := section(output, markerLoad, markerMem)
	memRaw := section(output, markerMem, markerDisk)
	diskRaw := section(output, markerDisk, markerTemp)
	tempRaw := section(output, markerTemp, markerTop)
	topRaw := section(output, markerTop, "")

	stats := &DeviceStats{}
	loadParts := strings.Fields(loadRaw)
	for index, target := range []**float64{&stats.Load1M, &stats.Load5M, &stats.Load15M} {
		if index >= len(loadParts) {
			break
		}
		if value, err := strconv.ParseFloat(loadParts[index], 64); err == nil {
			*target = &value
		}
	}
	if match := topCPU.FindStringSubmatch(topRaw); match != nil {
		if idle := topIdle.FindStringSubmatch(topRaw); idle != nil {
			total, _ := strconv.Atoi(match[1])
			idleValue, _ := strconv.Atoi(idle[1])
			if total > 0 {
				value := int(float64(total-idleValue)/float64(total)*100 + 0.5)
				stats.CPUPct = &value
			}
		}
	}

	memInfo := map[string]int{}
	for _, line := range strings.Split(memRaw, "\n") {
		if match := memLine.FindStringSubmatch(strings.TrimSpace(line)); match != nil {
			value, _ := strconv.Atoi(match[2])
			memInfo[match[1]] = value
		}
	}
	stats.MemTotalKB = memInfo["MemTotal"]
	stats.MemFreeKB = memInfo["MemAvailable"]
	if stats.MemFreeKB == 0 {
		stats.MemFreeKB = memInfo["MemFree"]
	}
	stats.MemUsedKB = stats.MemTotalKB - stats.MemFreeKB
	stats.SwapTotalKB = memInfo["SwapTotal"]
	stats.SwapUsedKB = stats.SwapTotalKB - memInfo["SwapFree"]
	stats.MemTotal = formatKB(stats.MemTotalKB)
	stats.MemUsed = formatKB(stats.MemUsedKB)
	stats.MemFree = formatKB(stats.MemFreeKB)
	if stats.MemTotalKB > 0 {
		value := int(float64(stats.MemUsedKB)/float64(stats.MemTotalKB)*100 + 0.5)
		stats.MemPct = &value
	}

	diskParts := strings.Fields(diskRaw)
	if len(diskParts) >= 6 {
		stats.DiskTotal = diskParts[1]
		stats.DiskUsed = diskParts[2]
		stats.DiskFree = diskParts[3]
		if percent := strings.TrimSuffix(diskParts[4], "%"); percent != "" {
			if value, err := strconv.Atoi(percent); err == nil {
				stats.DiskPct = &value
			}
		}
	}
	if match := tempLine.FindStringSubmatch(tempRaw); match != nil {
		raw, _ := strconv.Atoi(match[1])
		value := raw / 10
		stats.Temp = &value
	}
	return stats
}

func section(output, start, end string) string {
	startIndex := strings.Index(output, start)
	if startIndex < 0 {
		return ""
	}
	content := output[startIndex+len(start):]
	if end != "" {
		if endIndex := strings.Index(content, end); endIndex >= 0 {
			content = content[:endIndex]
		}
	}
	return strings.TrimSpace(content)
}

func formatKB(kb int) string {
	switch {
	case kb >= 1_048_576:
		return fmt.Sprintf("%.1fG", float64(kb)/1_048_576)
	case kb >= 1024:
		return fmt.Sprintf("%dM", int(float64(kb)/1024+0.5))
	default:
		return fmt.Sprintf("%dK", kb)
	}
}
