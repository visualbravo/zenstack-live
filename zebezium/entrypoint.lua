#!/usr/bin/env lua

local function getEnv(name)
    return os.getenv(name) or ''
end

local function shellQuote(value)
    return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function urlDecode(value)
    return (value:gsub('+', ' '):gsub('%%(%x%x)', function(hex)
        return string.char(tonumber(hex, 16))
    end))
end

local function parseUrl(url)
    local scheme, rest = url:match('^([^:]+)://(.*)$')

    if not scheme then
        error('invalid URL: ' .. url)
    end

    local query = ''
    local queryPos = rest:find('?', 1, true)

    if queryPos then
        query = rest:sub(queryPos + 1)
        rest = rest:sub(1, queryPos - 1)
    end

    local path = ''
    local pathPos = rest:find('/', 1, true)

    if pathPos then
        path = rest:sub(pathPos + 1)
        rest = rest:sub(1, pathPos - 1)
    end

    local user, password = '', ''
    local atPos = rest:match('.*()@')

    if atPos then
        local userInfo = rest:sub(1, atPos - 1)
        rest = rest:sub(atPos + 1)

        local colonPos = userInfo:find(':', 1, true)

        if colonPos then
            user = urlDecode(userInfo:sub(1, colonPos - 1))
            password = urlDecode(userInfo:sub(colonPos + 1))
        else
            user = urlDecode(userInfo)
        end
    end

    local host, port
    local ipv6Host, ipv6Port = rest:match('^(%b[]):(%d+)$')

    if ipv6Host then
        host, port = ipv6Host:sub(2, -2), ipv6Port
    else
        local regularHost, regularPort = rest:match('^([^:]+):(%d+)$')

        if regularHost then
            host, port = regularHost, regularPort
        else
            host = rest:gsub('^%[', ''):gsub('%]$', '')
            port = ''
        end
    end

    return {
        scheme = scheme,
        user = user,
        password = password,
        host = host,
        port = port or '',
        path = path,
        query = query,
    }
end

local function queryParam(query, name)
    for pair in (query .. '&'):gmatch('(.-)&') do
        local key, value = pair:match('^([^=]*)=(.*)$')

        if not key then
            key, value = pair, ''
        end

        if key == name then
            return urlDecode(value)
        end
    end

    return ''
end

local env = {}

local function get(name)
    if env[name] ~= nil then
        return env[name]
    end

    return getEnv(name)
end

local function set(name, value)
    env[name] = tostring(value)
end

local function defaultEnv(name, value)
    if get(name) == '' then
        set(name, value)
    end
end

local function fail(message)
    io.stderr:write('zebezium: ' .. message .. '\n')
    os.exit(1)
end

local databaseUrl = getEnv('DATABASE_URL')

if databaseUrl ~= '' then
    local url = parseUrl(databaseUrl)
    local dialect

    if url.scheme == 'postgres' or url.scheme == 'postgresql' then
        dialect = 'postgres'

        set(
            'DEBEZIUM_SOURCE_CONNECTOR_CLASS',
            'io.debezium.connector.postgresql.PostgresConnector'
        )
        set(
            'DEBEZIUM_SOURCE_DATABASE_PORT',
            url.port ~= '' and url.port or '5432'
        )

        if url.path ~= '' then
            set('DEBEZIUM_SOURCE_DATABASE_DBNAME', urlDecode(url.path))
        end

        defaultEnv('DEBEZIUM_SOURCE_PLUGIN_NAME', 'pgoutput')
        defaultEnv('DEBEZIUM_SOURCE_PUBLICATION_AUTOCREATE_MODE', 'no_tables')
        defaultEnv('DEBEZIUM_SOURCE_PUBLICATION_NAME', 'zenstack_live')

        local sslMode = queryParam(url.query, 'sslmode')

        if sslMode ~= '' then
            set('DEBEZIUM_SOURCE_DATABASE_SSLMODE', sslMode)
        end
    elseif url.scheme == 'mysql' then
        dialect = 'mysql'

        set(
            'DEBEZIUM_SOURCE_CONNECTOR_CLASS',
            'io.debezium.connector.mysql.MySqlConnector'
        )
        set(
            'DEBEZIUM_SOURCE_DATABASE_PORT',
            url.port ~= '' and url.port or '3306'
        )

        defaultEnv(
            'DEBEZIUM_SOURCE_DATABASE_INCLUDE_LIST',
            urlDecode(url.path)
        )

        defaultEnv('DEBEZIUM_SOURCE_DATABASE_SERVER_ID', '1')
        defaultEnv('DEBEZIUM_SOURCE_INCLUDE_SCHEMA_CHANGES', 'false')

        local sslMode = queryParam(url.query, 'ssl-mode')

        if sslMode ~= '' then
            set('DEBEZIUM_SOURCE_DATABASE_SSL_MODE', sslMode:lower())
        end
    else
        fail(
            'unsupported DATABASE_URL scheme "' .. url.scheme
            .. '", expected postgresql or mysql'
        )
    end

    set('DEBEZIUM_SOURCE_DATABASE_HOSTNAME', url.host)

    if url.user ~= '' then
        set('DEBEZIUM_SOURCE_DATABASE_USER', url.user)
    end

    if url.password ~= '' then
        set('DEBEZIUM_SOURCE_DATABASE_PASSWORD', url.password)
    end

    defaultEnv(
        'DEBEZIUM_SOURCE_TOPIC_PREFIX',
        'zenstack.' .. dialect .. '.table'
    )
    defaultEnv(
        'DEBEZIUM_SOURCE_OFFSET_STORAGE_REDIS_KEY',
        'zenstack.' .. dialect .. '.metadata.offsets'
    )
end

local redisUrl = getEnv('REDIS_URL')

if redisUrl ~= '' then
    local url = parseUrl(redisUrl)
    local address = url.host .. ':' ..
        (url.port ~= '' and url.port or '6379')
    local ssl = url.scheme == 'rediss' and 'true' or 'false'

    local prefixes = {
        'DEBEZIUM_SINK_REDIS',
        'DEBEZIUM_SOURCE_OFFSET_STORAGE_REDIS',
    }

    for _, prefix in ipairs(prefixes) do
        set(prefix .. '_ADDRESS', address)
        set(prefix .. '_SSL_ENABLED', ssl)

        if url.user ~= '' then
            set(prefix .. '_USER', url.user)
        end

        if url.password ~= '' then
            set(prefix .. '_PASSWORD', url.password)
        end
    end
end

local missing = {}

if get('DEBEZIUM_SOURCE_DATABASE_HOSTNAME') == '' then
    missing[#missing + 1] = 'DATABASE_URL'
end

if get('DEBEZIUM_SINK_REDIS_ADDRESS') == '' then
    missing[#missing + 1] = 'REDIS_URL'
end

if #missing > 0 then
    fail('missing required environment variables: ' .. table.concat(missing, ' '))
end

local command = { 'env' }

for name, value in pairs(env) do
    command[#command + 1] = name .. '=' .. shellQuote(value)
end

command[#command + 1] = '/debezium/run.sh'

for i = 1, #arg do
    command[#command + 1] = shellQuote(arg[i])
end

local status = os.execute(table.concat(command, ' '))

if type(status) == 'number' then
    os.exit(status)
elseif status == true then
    os.exit(0)
else
    os.exit(1)
end
