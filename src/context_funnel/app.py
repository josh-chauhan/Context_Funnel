import os
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.store.postgres import PostgresStore
from .graph import build_chat_graph

load_dotenv()
database_url = os.environ["DATABASE_URL"]

# Builds a compiled LangGraph graph and hands it both objects. 
with (
    PostgresSaver.from_conn_string(database_url) as checkpointer,  # The checkpointer makes it remember threads. 
    PostgresStore.from_conn_string(database_url) as store,  # The store is available to nodes inside the graph.
):
    checkpointer.setup()
    store.setup()
    chat_graph = build_chat_graph(checkpointer, store)

    # Testing that two separate threads are implemented and have different history:
    while True:
        thread_id = input("Thread ID (A/B, or q to quit): ").strip()
        if thread_id.lower() == "q":
            break

        # LangGraph identifies thread, uses the history under that ID.
        config = {"configurable": {"thread_id": thread_id}}  
        existing = chat_graph.get_state(config).values.get("messages", [])
        messages = []

        # Only load context when this destination thread is new.
        if not existing:
            source_id = input("Source thread ID to funnel from (blank for none): ").strip()

            if source_id and source_id != thread_id:
                source_config = {"configurable": {"thread_id": source_id}}
                source = chat_graph.get_state(source_config)
                source_messages = source.values.get("messages", [])

                context_text = "\n".join(
                    f"{message.type}: {message.content}"
                    for message in source_messages
                    if message.type in {"human", "ai"}  # Keeps only human and AI turns.
                )

                # Stores context text under an id in a dict
                if context_text:
                    namespace = ("thread_context", thread_id)
                    store.put(namespace, source_id, {"text": context_text})
                    saved_context = store.get(namespace, source_id)

                    if saved_context:
                        messages.append(SystemMessage(
                            content="Use this prior conversation as background:\n"
                            + saved_context.value["text"]
                        ))

        prompt = input("Your prompt: ")
        messages.append(HumanMessage(content=prompt))

        result = chat_graph.invoke({"messages": messages}, config=config)
        # Prints context (for debugging)
        for message in chat_graph.get_state(config).values["messages"]:
            if isinstance(message, SystemMessage):
                print("Funnelled context:", message.content)

        print(result["messages"][-1].content)