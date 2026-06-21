from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore',
    )

    app_name: str = 'olt-automation-service'
    app_version: str = '1.0.0'
    debug: bool = False

    # Red interna VPN — solo aceptar conexiones desde el backend NestJS
    allowed_origins: list[str] = ['http://localhost:3000', 'http://127.0.0.1:3000']

    # Secreto compartido con el backend para autenticar llamadas internas
    internal_api_key: str = 'change-me-in-production'

    # Timeouts SSH (segundos)
    ssh_connect_timeout: int = 30
    ssh_auth_timeout: int = 20
    ssh_banner_timeout: int = 15
    ssh_command_timeout: int = 60

    # Netmiko: reintentos ante caída de conexión
    ssh_max_retries: int = 2

    # Timeout máximo esperando adquirir el lock por OLT (segundos).
    # Si una operación ocupa el lock más de este tiempo, las peticiones
    # en cola reciben 503 en lugar de esperar indefinidamente.
    lock_acquire_timeout: int = 60


settings = Settings()
