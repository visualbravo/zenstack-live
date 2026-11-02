FROM quay.io/debezium/server:3.7.0.Final

ENV DATABASE_USER=default \
    DEBEZIUM_FORMAT_SCHEMAS_ENABLE=false \
    DEBEZIUM_SINK_TYPE=redis \
    DEBEZIUM_SOURCE_CONNECTOR_CLASS=io.debezium.connector.postgresql.PostgresConnector \
    DEBEZIUM_SOURCE_DECIMAL_HANDLING_MODE=string \
    DEBEZIUM_SOURCE_DATABASE_SERVER_NAME=zenstack \
    DEBEZIUM_SOURCE_PLUGIN_NAME=pgoutput \
    DEBEZIUM_SOURCE_PUBLICATION_AUTOCREATE_MODE=no_tables \
    DEBEZIUM_SOURCE_PUBLICATION_NAME=zenstack_live \
    DEBEZIUM_SOURCE_SNAPSHOT_MODE=no_data \
    DEBEZIUM_SOURCE_TIME_PRECISION_MODE=isostring \
    DEBEZIUM_SOURCE_TOPIC_PREFIX=zenstack.table \
    DEBEZIUM_SOURCE_SCHEMA_HISTORY_INTERNAL=io.debezium.storage.redis.history.RedisSchemaHistory \
    DEBEZIUM_SOURCE_OFFSET_STORAGE=io.debezium.storage.redis.offset.RedisOffsetBackingStore \
    DEBEZIUM_SOURCE_OFFSET_STORAGE_REDIS_KEY=zenstack.metadata.offsets

COPY --chmod=755 entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
