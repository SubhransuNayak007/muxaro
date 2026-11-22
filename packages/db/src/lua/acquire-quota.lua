-- MUXARO Media Processing Platform - Atomic Quota & Concurrency Acquisition Lua Script
--
-- Evaluates and acquires concurrent active slots and daily usage allowances atomically in Redis.
-- Eliminates race conditions and thundering herd concurrency exploits.
--
-- KEYS[1] = muxaro:quota:active:{subject}
-- KEYS[2] = muxaro:quota:daily:{subject}:{yyyy-mm-dd}
-- ARGV[1] = job_id
-- ARGV[2] = max_concurrent
-- ARGV[3] = max_daily_jobs

local active_key = KEYS[1]
local daily_key = KEYS[2]
local job_id = ARGV[1]
local max_concurrent = tonumber(ARGV[2])
local max_daily_jobs = tonumber(ARGV[3])

-- 1. Check active concurrent jobs
local active_count = redis.call('SCARD', active_key)
if active_count >= max_concurrent then
    return {0, 'CONCURRENT_LIMIT_REACHED'}
end

-- 2. Check daily job limit
local daily_raw = redis.call('GET', daily_key)
local daily_count = daily_raw and tonumber(daily_raw) or 0
if daily_count >= max_daily_jobs then
    return {0, 'DAILY_QUOTA_REACHED'}
end

-- 3. Atomically allocate quota:
-- SADD active job_id, expire in 3600s, INCR daily, expire in 90000s, return {1, 'OK'}
redis.call('SADD', active_key, job_id)
redis.call('EXPIRE', active_key, 3600)
redis.call('INCR', daily_key)
redis.call('EXPIRE', daily_key, 90000)

return {1, 'OK'}
